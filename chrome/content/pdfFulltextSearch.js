/*
 * Zotero PDF Fulltext Search for Zotero 6.x
 * Adds an inline Mendeley-like search panel above the item list, searches indexed PDF
 * attachment content, shows highlighted PDF text snippets in the current Zotero pane,
 * and provides previous/next result navigation in the results summary row.
 * v0.3.5: refined compact toolbar alignment for input and buttons.
 */
(function () {
    var XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
    var HTML_NS = "http://www.w3.org/1999/xhtml";

    var ZoteroPDFFulltextSearch = {
        panelID: "zotero-pdf-fulltext-search-panel",
        toolbarBoxID: "zotero-pdf-fulltext-search-toolbar-box",
        inputID: "zotero-pdf-fulltext-search-input",
        statusID: "zotero-pdf-fulltext-search-status",
        resultsID: "zotero-pdf-fulltext-search-results",
        summaryID: "zotero-pdf-fulltext-search-summary",
        closeResultsID: "zotero-pdf-fulltext-search-close-results",
        prevButtonID: "zotero-pdf-fulltext-search-prev",
        nextButtonID: "zotero-pdf-fulltext-search-next",
        currentResultIndex: -1,
        lastResultCount: 0,
        maxResults: 100,
        maxSnippetsPerPDF: 4,
        snippetRadius: 260,

        init: function () {
            // Zotero 6 main window may load panels asynchronously, so keep retrying
            // until both the native quick-search area and the item tree are available.
            if (document.getElementById(this.inputID) && document.getElementById(this.panelID)) {
                return;
            }

            this._ensureCompactToolbarStyle();

            var itemTree = document.getElementById("zotero-items-tree");
            var parent = itemTree ? itemTree.parentNode : null;

            if (!parent || !itemTree) {
                var selfRetry = this;
                window.setTimeout(function () { selfRetry.init(); }, 500);
                return;
            }

            // 1) Place the plugin search box to the LEFT of Zotero's native quick-search box.
            //    If the native box cannot be found in a particular Zotero 6 build, fall back
            //    to the previous layout above the item list.
            var nativeSearch = this._findNativeSearchBox();
            var placedInToolbar = false;
            var searchRow = this._createSearchRow(!!nativeSearch);

            if (nativeSearch && nativeSearch.parentNode && !document.getElementById(this.toolbarBoxID)) {
                var toolbarBox = this._createXUL("hbox", {
                    id: this.toolbarBoxID,
                    align: "center",
                    style: "margin:0 8px 0 0; padding:0 2px; min-height:30px; height:30px; -moz-box-align:center;"
                });
                toolbarBox.appendChild(searchRow);
                try {
                    nativeSearch.parentNode.insertBefore(toolbarBox, nativeSearch);
                    placedInToolbar = true;
                }
                catch (eInsert) {
                    try { Zotero.logError(eInsert); } catch (ignoreInsert) {}
                }
            }

            // 2) Keep the actual result list in the current main pane, above Zotero's item list.
            var panel = document.getElementById(this.panelID);
            if (!panel) {
                panel = this._createXUL("vbox", {
                    id: this.panelID,
                    style: "border-bottom:1px solid #c7c7c7; background-color:#f7f7f7;"
                });

                if (!placedInToolbar) {
                    // Fallback only: if we cannot locate the built-in search box, keep a larger
                    // plugin search row above the item list so the plugin remains usable.
                    panel.appendChild(searchRow);
                }

                var summaryRow = this._createXUL("hbox", {
                    id: this.summaryID,
                    align: "center",
                    hidden: "true",
                    style: "padding:4px 8px; border-top:1px solid #ddd; background:#ffffff; min-height:34px;"
                });
                var summaryLabel = this._createXUL("label", {
                    id: this.summaryID + "-label",
                    value: "",
                    style: "color:#333; margin-right:8px;"
                });
                var closeButton = this._createXUL("button", {
                    id: this.closeResultsID,
                    label: "收起结果",
                    style: "min-height:24px; height:24px; margin-top:1px; margin-bottom:1px;"
                });
                var summarySpacer = this._createXUL("spacer", {
                    flex: "1"
                });
                var summaryStatus = this._createXUL("label", {
                    id: this.statusID,
                    value: "",
                    style: "margin-right:10px; color:#555; min-width:90px; text-align:right;"
                });
                var prevButton = this._createXUL("button", {
                    id: this.prevButtonID,
                    label: "上一个",
                    disabled: "true",
                    style: "min-height:26px; margin-right:6px;"
                });
                var nextButton = this._createXUL("button", {
                    id: this.nextButtonID,
                    label: "下一个",
                    disabled: "true",
                    style: "min-height:24px; height:24px; margin-top:1px; margin-bottom:1px;"
                });
                var self = this;
                closeButton.addEventListener("command", function () { self.hideResults(); }, false);
                prevButton.addEventListener("command", function () { self.gotoPreviousResult(); }, false);
                nextButton.addEventListener("command", function () { self.gotoNextResult(); }, false);
                summaryRow.appendChild(summaryLabel);
                summaryRow.appendChild(closeButton);
                summaryRow.appendChild(summarySpacer);
                summaryRow.appendChild(summaryStatus);
                summaryRow.appendChild(prevButton);
                summaryRow.appendChild(nextButton);
                panel.appendChild(summaryRow);

                var results = this._createHTML("div", {
                    id: this.resultsID,
                    style: this._resultsStyle(false)
                });
                panel.appendChild(results);

                parent.insertBefore(panel, itemTree);
            }
        },

        _ensureCompactToolbarStyle: function () {
            // XUL textbox height can be expanded by Zotero/Firefox theme rules.
            // Inject a small stylesheet so the custom PDF search box stays compact
            // and vertically centered beside Zotero's native quick-search box.
            if (document.getElementById("zotero-pdf-fulltext-search-compact-style")) {
                return;
            }
            try {
                var style = this._createHTML("style", {
                    id: "zotero-pdf-fulltext-search-compact-style",
                    type: "text/css"
                });
                style.textContent =
                    "#" + this.toolbarBoxID + " { min-height:30px !important; height:30px !important; max-height:30px !important; -moz-box-align:center !important; -moz-box-pack:center !important; align-items:center !important; padding-top:0 !important; padding-bottom:0 !important; margin-top:0 !important; margin-bottom:0 !important; }" +
                    "#" + this.toolbarBoxID + " hbox { min-height:30px !important; height:30px !important; max-height:30px !important; -moz-box-align:center !important; -moz-box-pack:center !important; align-items:center !important; padding-top:0 !important; padding-bottom:0 !important; margin-top:0 !important; margin-bottom:0 !important; }" +
                    "#" + this.toolbarBoxID + " label { line-height:22px !important; margin-top:0 !important; margin-bottom:0 !important; padding-top:0 !important; padding-bottom:0 !important; }" +
                    "#" + this.inputID + " { height:22px !important; min-height:22px !important; max-height:22px !important; padding-top:0 !important; padding-bottom:0 !important; margin-top:0 !important; margin-bottom:0 !important; -moz-box-align:center !important; }" +
                    "#" + this.inputID + " .textbox-input-box { min-height:18px !important; height:18px !important; padding-top:0 !important; padding-bottom:0 !important; margin-top:0 !important; margin-bottom:0 !important; }" +
                    "#" + this.inputID + " input { height:18px !important; min-height:18px !important; line-height:18px !important; padding-top:0 !important; padding-bottom:0 !important; margin-top:0 !important; margin-bottom:0 !important; }" +
                    "#" + this.searchButtonID + ", #" + this.clearButtonID + " { height:24px !important; min-height:24px !important; max-height:24px !important; margin-top:0 !important; margin-bottom:0 !important; padding-top:0 !important; padding-bottom:0 !important; -moz-box-align:center !important; -moz-box-pack:center !important; }" +
                    "#" + this.searchButtonID + " .button-box, #" + this.clearButtonID + " .button-box { height:22px !important; min-height:22px !important; max-height:22px !important; padding-top:0 !important; padding-bottom:0 !important; margin-top:0 !important; margin-bottom:0 !important; -moz-box-align:center !important; -moz-box-pack:center !important; }" +
                    "#" + this.searchButtonID + " .button-text, #" + this.clearButtonID + " .button-text { line-height:22px !important; margin-top:0 !important; margin-bottom:0 !important; padding-top:0 !important; padding-bottom:0 !important; }";
                var root = document.documentElement || document.getElementsByTagName("window")[0] || document.getElementsByTagName("overlay")[0];
                if (root && root.appendChild) {
                    root.appendChild(style);
                }
            }
            catch (e) {
                try { Zotero.logError(e); } catch (ignore) {}
            }
        },

        _findNativeSearchBox: function () {
            // Zotero 6 builds/themes may expose the quick search box under slightly
            // different IDs, so try common IDs first and then use a conservative scan.
            var ids = [
                "zotero-tb-search",
                "zotero-tb-search-box",
                "zotero-tb-search-textbox",
                "zotero-search-box",
                "zotero-quick-search",
                "quick-search-textbox"
            ];
            for (var i = 0; i < ids.length; i++) {
                var el = document.getElementById(ids[i]);
                if (el && el.id !== this.inputID && el.id !== this.toolbarBoxID) {
                    return el;
                }
            }

            var nodes = document.getElementsByTagName("*");
            for (var j = 0; j < nodes.length; j++) {
                var n = nodes[j];
                var id = (n.getAttribute && n.getAttribute("id")) || "";
                var local = (n.localName || "").toLowerCase();
                if (!id || id === this.inputID || id === this.toolbarBoxID) {
                    continue;
                }
                if (/zotero.*(search|quick)|quick.*search|tb.*search/i.test(id)
                    && /textbox|searchbox|hbox|toolbaritem|box/.test(local)) {
                    return n;
                }
            }
            return null;
        },

        _createSearchRow: function (compact) {
            var row = this._createXUL("hbox", {
                align: "center",
                style: compact
                    ? "padding:0; margin:0; min-height:30px; height:30px; max-height:30px; -moz-box-align:center;"
                    : "padding:4px 6px; min-height:30px; -moz-box-align:center;"
            });
            var title = this._createXUL("label", {
                value: compact ? "PDF全文：" : "PDF全文检索：",
                style: "font-weight:bold; margin-right:6px; margin-top:0; margin-bottom:0; padding-top:0; padding-bottom:0; line-height:22px;"
            });
            var input = this._createXUL("textbox", {
                id: this.inputID,
                emptytext: "PDF全文检索，按 Enter",
                tooltiptext: "输入关键词或短语，按 Enter 在当前界面显示 PDF 正文片段",
                style: compact
                    ? "width:330px; min-width:330px; height:22px; min-height:22px; max-height:22px; font-size:12px; padding:0 4px; margin:0 8px 0 0; box-sizing:border-box;"
                    : "min-width:430px; height:24px; min-height:24px; max-height:24px; font-size:12px; padding:0 4px; margin:0 8px 0 0; box-sizing:border-box;"
            });
            var searchButton = this._createXUL("button", {
                id: this.searchButtonID,
                label: "检索",
                style: "height:24px; min-height:24px; max-height:24px; padding:0 14px; margin:0 6px 0 0; -moz-box-align:center; -moz-box-pack:center;"
            });
            var clearButton = this._createXUL("button", {
                id: this.clearButtonID,
                label: "清空",
                style: "height:24px; min-height:24px; max-height:24px; padding:0 14px; margin:0 8px 0 0; -moz-box-align:center; -moz-box-pack:center;"
            });
            var toolbarStatus = this._createXUL("label", {
                id: this.statusID + "-toolbar",
                value: "",
                style: "margin-left:4px; color:#555; max-width:160px; line-height:22px;"
            });

            var self = this;
            input.addEventListener("keypress", function (event) {
                if (event.keyCode === 13) {
                    self.search();
                }
            }, false);
            searchButton.addEventListener("command", function () { self.search(); }, false);
            clearButton.addEventListener("command", function () { self.clear(); }, false);
            row.appendChild(title);
            row.appendChild(input);
            row.appendChild(searchButton);
            row.appendChild(clearButton);
            row.appendChild(toolbarStatus);
            return row;
        },

        _resultsStyle: function (visible) {
            return "display:" + (visible ? "block" : "none") + "; max-height:420px; overflow-y:auto; overflow-x:hidden; background:#fff; border-top:1px solid #ddd; font: menu; color:#202124;";
        },

        _createXUL: function (tag, attrs) {
            var node = document.createElementNS(XUL_NS, tag);
            attrs = attrs || {};
            for (var key in attrs) {
                if (attrs.hasOwnProperty(key)) {
                    node.setAttribute(key, attrs[key]);
                }
            }
            return node;
        },

        _createHTML: function (tag, attrs) {
            var node = document.createElementNS(HTML_NS, tag);
            attrs = attrs || {};
            for (var key in attrs) {
                if (attrs.hasOwnProperty(key)) {
                    node.setAttribute(key, attrs[key]);
                }
            }
            return node;
        },

        _setStatus: function (msg) {
            var status = document.getElementById(this.statusID);
            var toolbarStatus = document.getElementById(this.statusID + "-toolbar");
            var summaryRow = document.getElementById(this.summaryID);
            var summaryVisible = summaryRow && !summaryRow.hasAttribute("hidden");
            if (status) {
                status.setAttribute("value", msg || "");
            }
            if (toolbarStatus) {
                toolbarStatus.setAttribute("value", summaryVisible ? "" : (msg || ""));
            }
        },

        _setSummary: function (msg) {
            var row = document.getElementById(this.summaryID);
            var label = document.getElementById(this.summaryID + "-label");
            if (row) {
                if (msg) {
                    row.removeAttribute("hidden");
                }
                else {
                    row.setAttribute("hidden", "true");
                }
            }
            if (label) {
                label.setAttribute("value", msg || "");
            }
            var toolbarStatus = document.getElementById(this.statusID + "-toolbar");
            if (toolbarStatus && msg) {
                toolbarStatus.setAttribute("value", "");
            }
        },

        _getInputValue: function () {
            var input = document.getElementById(this.inputID);
            return input ? (input.value || "").replace(/^\s+|\s+$/g, "") : "";
        },

        clear: function () {
            var input = document.getElementById(this.inputID);
            if (input) {
                input.value = "";
            }
            this._setStatus("");
            this.currentResultIndex = -1;
            this.lastResultCount = 0;
            this._updateNavButtons();
            this.hideResults(true);
        },

        hideResults: function (clearContent) {
            var results = document.getElementById(this.resultsID);
            if (results) {
                results.setAttribute("style", this._resultsStyle(false));
                if (clearContent) {
                    while (results.firstChild) {
                        results.removeChild(results.firstChild);
                    }
                    this.currentResultIndex = -1;
                    this.lastResultCount = 0;
                    this._updateNavButtons();
                }
            }
            this._setSummary("");
        },

        showResults: function () {
            var results = document.getElementById(this.resultsID);
            if (results) {
                results.setAttribute("style", this._resultsStyle(true));
            }
        },

        search: async function () {
            var query = this._getInputValue();

            if (!query) {
                this._setStatus("请输入检索词");
                this.hideResults(true);
                return;
            }

            this._setStatus("检索 PDF 正文中……");
            this._setSummary("正在检索：“" + query + "”……");
            this._renderLoading(query);

            try {
                var pane = Zotero.getActiveZoteroPane ? Zotero.getActiveZoteroPane() : window.ZoteroPane;
                var libraryID = Zotero.Libraries.userLibraryID;
                if (pane && pane.getSelectedLibraryID) {
                    libraryID = pane.getSelectedLibraryID() || libraryID;
                }

                var s = new Zotero.Search();
                s.libraryID = libraryID;
                s.addCondition("itemType", "is", "attachment");
                s.addCondition("fulltextContent", "contains", query);

                var itemIDs = await s.search();
                var items = await Zotero.Items.getAsync(itemIDs);
                var pdfAttachments = [];

                for (var i = 0; i < items.length; i++) {
                    var item = items[i];
                    if (!item || !item.isAttachment || !item.isAttachment()) {
                        continue;
                    }
                    if (this._isPDFAttachment(item)) {
                        pdfAttachments.push(item);
                    }
                }

                var limit = Math.min(pdfAttachments.length, this.maxResults);
                var results = [];
                for (var j = 0; j < limit; j++) {
                    var att = pdfAttachments[j];
                    var parentItem = att.parentID ? await Zotero.Items.getAsync(att.parentID) : null;
                    var text = await this._getFulltextText(att);
                    var snippets = this._getSnippets(text, query, this.maxSnippetsPerPDF, this.snippetRadius);

                    results.push({
                        attachmentID: att.id,
                        parentID: parentItem ? parentItem.id : null,
                        title: this._getDisplayTitle(att, parentItem),
                        meta: this._getMetaLine(att, parentItem),
                        fileName: this._getAttachmentFileName(att),
                        snippets: snippets,
                        textAvailable: !!text
                    });
                }

                this._setStatus("找到 " + pdfAttachments.length + " 个 PDF 匹配");
                this.renderInlineResults({
                    query: query,
                    total: pdfAttachments.length,
                    shown: results.length,
                    truncated: pdfAttachments.length > limit,
                    results: results
                });
            }
            catch (e) {
                Zotero.logError(e);
                this._setStatus("检索失败，请打开 Tools → Developer → Error Console 查看错误");
                this._renderError("检索失败。请确认 Zotero 已完成全文索引，或打开 Tools → Developer → Error Console 查看具体错误。");
            }
        },

        _renderLoading: function (query) {
            var box = document.getElementById(this.resultsID);
            if (!box) return;
            while (box.firstChild) {
                box.removeChild(box.firstChild);
            }
            var loading = this._createHTML("div", {
                style: "padding:14px 16px; color:#555;"
            });
            loading.textContent = "正在搜索 PDF 正文并提取上下文片段：“" + query + "”";
            box.appendChild(loading);
            this.currentResultIndex = -1;
            this.lastResultCount = 0;
            this._updateNavButtons();
            this.showResults();
        },

        _renderError: function (msg) {
            var box = document.getElementById(this.resultsID);
            if (!box) return;
            while (box.firstChild) {
                box.removeChild(box.firstChild);
            }
            var div = this._createHTML("div", {
                style: "padding:14px 16px; color:#8a1f11; background:#fff5f5; border-top:1px solid #f0c0c0;"
            });
            div.textContent = msg || "检索失败。";
            box.appendChild(div);
            this.currentResultIndex = -1;
            this.lastResultCount = 0;
            this._updateNavButtons();
            this.showResults();
        },

        renderInlineResults: function (payload) {
            var box = document.getElementById(this.resultsID);
            if (!box) return;

            while (box.firstChild) {
                box.removeChild(box.firstChild);
            }

            var msg = "找到 " + payload.total + " 个 PDF 匹配；当前显示 " + payload.shown + " 个。";
            if (payload.truncated) {
                msg += " 结果较多，仅显示前 " + payload.shown + " 个，请增加关键词缩小范围。";
            }
            msg += " 命中词已高亮。";
            this._setSummary(msg);

            var results = payload.results || [];
            this.lastResultCount = results.length;
            this.currentResultIndex = results.length ? 0 : -1;
            this._updateNavButtons();
            if (!results.length) {
                var empty = this._createHTML("div", {
                    style: "padding:14px 16px; color:#555;"
                });
                empty.textContent = "未找到匹配 PDF。若你确认 PDF 中有该内容，请检查 PDF 是否为扫描版、是否已 OCR，以及 Zotero 是否已完成全文索引。";
                box.appendChild(empty);
                this.showResults();
                return;
            }

            for (var i = 0; i < results.length; i++) {
                box.appendChild(this._renderOneInline(results[i], i, payload.query));
            }
            this.showResults();
            this._focusResult(this.currentResultIndex, false);
        },

        _renderOneInline: function (r, index, query) {
            var card = this._createHTML("div", {
                id: "zotero-pdf-fulltext-search-card-" + index,
                "data-pdf-search-card": "true",
                style: this._cardStyle(false)
            });

            var header = this._createHTML("div", {
                style: "display:flex; align-items:center; gap:6px; margin-bottom:4px;"
            });
            var title = this._createHTML("div", {
                style: "flex:1; min-width:0; font-weight:bold; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
            });
            title.textContent = (index + 1) + ". " + (r.title || "未命名PDF");
            header.appendChild(title);

            var locateButton = this._makeHTMLButton("定位条目");
            var openButton = this._makeHTMLButton("打开PDF");
            var copyButton = this._makeHTMLButton("复制片段");

            var self = this;
            locateButton.addEventListener("click", function () { self.locateItem(r.parentID || r.attachmentID); }, false);
            openButton.addEventListener("click", function () { self.openPDF(r.attachmentID); }, false);
            copyButton.addEventListener("click", function () { self._copySnippets(r); }, false);

            header.appendChild(locateButton);
            header.appendChild(openButton);
            header.appendChild(copyButton);
            card.appendChild(header);

            if (r.meta) {
                var meta = this._createHTML("div", {
                    style: "margin:2px 0 8px 18px; color:#666; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
                });
                meta.textContent = r.meta;
                card.appendChild(meta);
            }

            var snippets = r.snippets || [];
            for (var i = 0; i < snippets.length; i++) {
                var snippetBox = this._createHTML("div", {
                    style: "margin:6px 0 0 18px; padding:7px 9px; border-left:3px solid #b8b8b8; background:#fafafa; line-height:1.55; white-space:normal; word-break:break-word; font-size:12px;"
                });
                var prefix = this._createHTML("span", { style: "color:#777;" });
                prefix.textContent = "片段 " + (i + 1) + "：";
                snippetBox.appendChild(prefix);
                this._appendHighlightedText(snippetBox, snippets[i], query);
                card.appendChild(snippetBox);
            }

            return card;
        },



        _cardStyle: function (active) {
            if (active) {
                return "padding:10px 12px 12px 12px; border-bottom:1px solid #e6e6e6; background:#fffbe6; outline:2px solid #6aa3e5; outline-offset:-2px;";
            }
            return "padding:10px 12px 12px 12px; border-bottom:1px solid #e6e6e6; background:#fff; outline:0;";
        },

        _updateNavButtons: function () {
            var prev = document.getElementById(this.prevButtonID);
            var next = document.getElementById(this.nextButtonID);
            var enabled = this.lastResultCount > 0;
            if (prev) {
                if (enabled) prev.removeAttribute("disabled");
                else prev.setAttribute("disabled", "true");
            }
            if (next) {
                if (enabled) next.removeAttribute("disabled");
                else next.setAttribute("disabled", "true");
            }
        },

        gotoPreviousResult: function () {
            if (!this.lastResultCount) return;
            var nextIndex = this.currentResultIndex <= 0 ? this.lastResultCount - 1 : this.currentResultIndex - 1;
            this._focusResult(nextIndex, true);
        },

        gotoNextResult: function () {
            if (!this.lastResultCount) return;
            var nextIndex = this.currentResultIndex >= this.lastResultCount - 1 ? 0 : this.currentResultIndex + 1;
            this._focusResult(nextIndex, true);
        },

        _focusResult: function (index, shouldScroll) {
            if (index < 0 || index >= this.lastResultCount) return;
            for (var i = 0; i < this.lastResultCount; i++) {
                var oldCard = document.getElementById("zotero-pdf-fulltext-search-card-" + i);
                if (oldCard) {
                    oldCard.setAttribute("style", this._cardStyle(i === index));
                }
            }
            this.currentResultIndex = index;
            if (shouldScroll) {
                var card = document.getElementById("zotero-pdf-fulltext-search-card-" + index);
                if (card && card.scrollIntoView) {
                    card.scrollIntoView({ block: "nearest" });
                }
            }
            this._setStatus("第 " + (index + 1) + " / " + this.lastResultCount + " 个结果");
        },

        _makeHTMLButton: function (label) {
            var b = this._createHTML("button", {
                type: "button",
                style: "font: menu; padding:2px 7px; border:1px solid #bdbdbd; border-radius:3px; background:#f7f7f7; cursor:pointer; white-space:nowrap;"
            });
            b.textContent = label;
            return b;
        },

        _appendHighlightedText: function (container, text, query) {
            text = text || "";
            var terms = this._buildHighlightTerms(query);
            if (!terms.length) {
                container.appendChild(document.createTextNode(text));
                return;
            }

            var pattern = "(" + terms.map(this._escapeRegExp).join("|") + ")";
            var re = new RegExp(pattern, "gi");
            var last = 0;
            var match;
            while ((match = re.exec(text)) !== null) {
                if (match.index > last) {
                    container.appendChild(document.createTextNode(text.substring(last, match.index)));
                }
                var mark = this._createHTML("span", {
                    style: "background:#fff19a; color:#111; font-weight:bold; border-radius:2px; padding:0 1px;"
                });
                mark.textContent = match[0];
                container.appendChild(mark);
                last = match.index + match[0].length;
                if (match[0].length === 0) {
                    re.lastIndex++;
                }
            }
            if (last < text.length) {
                container.appendChild(document.createTextNode(text.substring(last)));
            }
        },

        _buildHighlightTerms: function (query) {
            query = (query || "").replace(/^\s+|\s+$/g, "");
            if (!query) return [];

            var seen = {};
            var terms = [];
            function addTerm(t) {
                t = (t || "").replace(/^\s+|\s+$/g, "");
                if (!t) return;
                var k = t.toLowerCase();
                if (seen[k]) return;
                seen[k] = true;
                terms.push(t);
            }

            addTerm(query);
            var words = query.split(/\s+/);
            for (var i = 0; i < words.length; i++) {
                // English terms shorter than 2 chars are usually too noisy; Chinese/Japanese terms are kept.
                if (words[i].length >= 2 || /[^\x00-\xff]/.test(words[i])) {
                    addTerm(words[i]);
                }
            }

            terms.sort(function (a, b) { return b.length - a.length; });
            return terms.slice(0, 20);
        },

        _escapeRegExp: function (s) {
            return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        },

        _isPDFAttachment: function (item) {
            try {
                if (item.isPDFAttachment && item.isPDFAttachment()) {
                    return true;
                }
            }
            catch (e) {}

            var contentType = "";
            try {
                contentType = item.attachmentContentType || "";
            }
            catch (e2) {}

            var title = "";
            try {
                title = item.getField("title") || "";
            }
            catch (e3) {}

            var fileName = "";
            try {
                fileName = item.attachmentFilename || "";
            }
            catch (e4) {}

            return contentType === "application/pdf" || /\.pdf$/i.test(title) || /\.pdf$/i.test(fileName);
        },

        _getDisplayTitle: function (att, parentItem) {
            var title = "";
            try {
                if (parentItem) {
                    title = parentItem.getField("title") || "";
                }
                if (!title) {
                    title = att.getField("title") || att.attachmentFilename || "未命名PDF";
                }
            }
            catch (e) {
                title = "未命名PDF";
            }
            return title;
        },

        _getAttachmentFileName: function (att) {
            try {
                return att.attachmentFilename || att.getField("title") || "";
            }
            catch (e) {
                return "";
            }
        },

        _getMetaLine: function (att, parentItem) {
            var parts = [];
            try {
                if (parentItem) {
                    var creators = parentItem.getCreators ? parentItem.getCreators() : [];
                    if (creators && creators.length) {
                        var c = creators[0];
                        var name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || "";
                        if (name) parts.push(name);
                    }
                    var year = parentItem.getField("date") || "";
                    if (year) parts.push(year);
                }
                var fileName = this._getAttachmentFileName(att);
                if (fileName) parts.push("PDF: " + fileName);
            }
            catch (e) {}
            return parts.join("  |  ");
        },

        _getFulltextText: async function (att) {
            var paths = [];

            // Preferred: Zotero's own full-text cache file, when the API is available.
            try {
                if (Zotero.Fulltext && Zotero.Fulltext.getItemCacheFile) {
                    var cacheFile = Zotero.Fulltext.getItemCacheFile(att.id);
                    if (cacheFile && cacheFile.then) {
                        cacheFile = await cacheFile;
                    }
                    if (cacheFile && cacheFile.path) {
                        paths.push(cacheFile.path);
                    }
                }
            }
            catch (e1) {
                try { Zotero.logError(e1); } catch (ignore1) {}
            }

            // Fallback: Zotero commonly stores extracted full text beside the attachment.
            try {
                var filePath = null;
                if (att.getFilePathAsync) {
                    filePath = await att.getFilePathAsync();
                }
                else if (att.getFilePath) {
                    filePath = att.getFilePath();
                }
                if (filePath) {
                    var dir = filePath.replace(/[\\\/][^\\\/]*$/, "");
                    paths.push(dir + this._pathSep(filePath) + ".zotero-ft-cache");
                }
            }
            catch (e2) {
                try { Zotero.logError(e2); } catch (ignore2) {}
            }

            for (var i = 0; i < paths.length; i++) {
                var text = await this._readTextFileIfExists(paths[i]);
                if (text) {
                    return text;
                }
            }
            return "";
        },

        _pathSep: function (path) {
            return path.indexOf("\\") >= 0 ? "\\" : "/";
        },

        _readTextFileIfExists: async function (path) {
            if (!path) return "";
            try {
                if (typeof OS === "undefined" || !OS.File) {
                    Components.utils.import("resource://gre/modules/osfile.jsm");
                }
                if (!(await OS.File.exists(path))) {
                    return "";
                }
                var content = await OS.File.read(path, { encoding: "utf-8" });
                if (typeof content === "string") {
                    return content;
                }
                try {
                    return new TextDecoder("utf-8").decode(content);
                }
                catch (decodeError) {
                    return "";
                }
            }
            catch (e) {
                try { Zotero.logError(e); } catch (ignore) {}
                return "";
            }
        },

        _getSnippets: function (text, query, maxSnippets, radius) {
            if (!text) {
                return ["未能读取该 PDF 的全文缓存。它虽然被 Zotero 搜索命中，但可能需要右键 PDF → Reindex Item，或在 Preferences → Search 中重建索引。"]; 
            }

            var normalized = text.replace(/\s+/g, " ");
            var lower = normalized.toLowerCase();
            var q = (query || "").toLowerCase().replace(/^\s+|\s+$/g, "");
            var indices = [];

            if (q) {
                var pos = lower.indexOf(q);
                while (pos !== -1 && indices.length < maxSnippets * 6) {
                    indices.push({ pos: pos, len: q.length });
                    pos = lower.indexOf(q, pos + Math.max(q.length, 1));
                }
            }

            // If the full phrase cannot be found in the cache, fall back to individual keywords.
            if (!indices.length) {
                var words = q.split(/\s+/).filter(function (w) { return w.length >= 2 || /[^\x00-\xff]/.test(w); });
                for (var w = 0; w < words.length && indices.length < maxSnippets * 6; w++) {
                    var p = lower.indexOf(words[w]);
                    while (p !== -1 && indices.length < maxSnippets * 6) {
                        indices.push({ pos: p, len: words[w].length });
                        p = lower.indexOf(words[w], p + Math.max(words[w].length, 1));
                    }
                }
            }

            if (!indices.length) {
                return ["Zotero 索引命中了该 PDF，但在全文缓存中没有找到可直接截取的完全一致文本。可能是大小写、换行、连字符、OCR 或索引缓存差异导致。"]; 
            }

            indices.sort(function (a, b) { return a.pos - b.pos; });
            var snippets = [];
            var lastEnd = -1;
            for (var i = 0; i < indices.length && snippets.length < maxSnippets; i++) {
                var idx = indices[i].pos;
                var len = indices[i].len || q.length || 1;
                var start = Math.max(0, idx - radius);
                var end = Math.min(normalized.length, idx + len + radius);
                if (start <= lastEnd) {
                    continue;
                }
                lastEnd = end;
                var piece = normalized.substring(start, end);
                if (start > 0) piece = "……" + piece;
                if (end < normalized.length) piece = piece + "……";
                snippets.push(piece);
            }

            return snippets.length ? snippets : ["已命中，但未生成有效上下文片段。"]; 
        },

        _copySnippets: function (r) {
            var lines = [];
            lines.push(r.title || "未命名PDF");
            if (r.meta) lines.push(r.meta);
            var snippets = r.snippets || [];
            for (var i = 0; i < snippets.length; i++) {
                lines.push("片段 " + (i + 1) + "：" + snippets[i]);
            }
            var text = lines.join("\n\n");
            try {
                Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                    .getService(Components.interfaces.nsIClipboardHelper)
                    .copyString(text);
                this._setStatus("片段已复制");
            }
            catch (e) {
                try { Zotero.logError(e); } catch (ignore) {}
                this._setStatus("复制失败");
            }
        },

        locateItem: async function (itemID) {
            try {
                var pane = Zotero.getActiveZoteroPane ? Zotero.getActiveZoteroPane() : window.ZoteroPane;
                if (pane && pane.selectItem) {
                    await pane.selectItem(itemID);
                }
            }
            catch (e) {
                Zotero.logError(e);
                this._setStatus("定位失败");
            }
        },

        openPDF: async function (attachmentID) {
            try {
                if (Zotero.Reader && Zotero.Reader.open) {
                    await Zotero.Reader.open(attachmentID);
                    return;
                }
            }
            catch (e) {
                Zotero.logError(e);
            }

            try {
                await this.locateItem(attachmentID);
            }
            catch (e2) {
                Zotero.logError(e2);
            }
        }
    };

    window.ZoteroPDFFulltextSearch = ZoteroPDFFulltextSearch;

    window.addEventListener("load", function () {
        window.setTimeout(function () {
            ZoteroPDFFulltextSearch.init();
        }, 500);
    }, false);
})();
