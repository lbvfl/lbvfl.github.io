(function () {
    'use strict';

 // original url = https://ko31k.github.io/LMP/plugins/Parsers.js
    var STORAGE_PARSERS = 'ps_list_combo_v4.1';
    var STORAGE_PRI_ACT = 'bat_url_two';
    var STORAGE_SEC_ACT = 'ps_active_sec_v4.1';
    var NO_PARSER       = 'no_parser';
    var PROXY_PREFIX    = 'https://parserbridge.lampame.v6.rocks/';

    var DEFAULT_PARSERS = [
        { base: 'lampa_uaj', shortName: 'LampaUAj', name: 'LampaUA jackett (toloka, mazepa.)', url: 'jackettua.mooo.com', displayUrl: 'http://jackettua.mooo.com', settings: { key: 'ua', parser_torrent_type: 'jackett' } },
        { base: 'lampa_ua', shortName: 'LampaUA', name: 'LampaUA (toloka, mazepa.)', url: 'lampaua.mooo.com', displayUrl: 'http://lampaua.mooo.com', settings: { key: '1', parser_torrent_type: 'jackett' } },
        { base: 'spawnum_duckdns_org_49117', shortName: 'Spawn (1)', name: 'SpawnUA (toloka, mazepa only)', url: 'http://spawnum.duckdns.org:49117', settings: { key: '2', parser_torrent_type: 'jackett' } },
        { base: 'spawnum_duckdns_org_59117', shortName: 'Spawn (2)', name: 'SpawnUA (toloka, mazepa, etc.)', url: 'http://spawnum.duckdns.org:59117', settings: { key: '2', parser_torrent_type: 'jackett' } },
        { base: 'spawpp_ua_59117', shortName: 'Spawnpp', name: 'SpawnppUA (toloka, mazepa, etc.)', url: 'http://spawn.pp.ua:59117', settings: { key: '2', parser_torrent_type: 'jackett' } },
        { base: 'otlampa', shortName: 'vsyake', name: 'Всяке різне (7)', url: 'http://87.120.84.218:9117', settings: { key: '333', parser_torrent_type: 'jackett' } },
        { base: 'jac_red', shortName: 'Jac.red', name: 'Jac.red (11)', url: 'jac.red', settings: { key: '', parser_torrent_type: 'jackett' } },
        { base: 'jac_black', shortName: 'Jac.black', name: 'Jac.black (13)', url: 'jac.black', settings: { key: '', parser_torrent_type: 'jackett' } },
        { base: 'alcopa', shortName: 'alcopaV2', name: 'alcopa v2 (13+)', url: 'https://tv.alcopa.cc/api/v2.0/indexers/all/results?title=', settings: { key: '', parser_torrent_type: 'jackett' } },
        { base: 'jac_stull', shortName: 'Jac.Stull', name: 'Jac.stull (12)', url: 'jac.stull.xyz', settings: { key: '1', parser_torrent_type: 'jackett' } },
        { base: 'jacred_stream', shortName: 'Jacred.Stream', name: 'Jacred stream (14)', url: 'jacred.stream', settings: { key: 'pp', parser_torrent_type: 'jackett' } },
        { base: '407_xyz', shortName: '407_xyz', name: '407_xyz (12)', url: '11.307407.xyz', settings: { key: '', parser_torrent_type: 'jackett' } },
        { base: 'jac_red_ru', shortName: 'Jac-red.ru', name: 'Jac-red.ru (12)', url: 'jac-red.ru', settings: { key: '', parser_torrent_type: 'jackett' } },
        { base: 'jr_maxvol', shortName: 'Jr.Maxvol', name: 'Jr.Maxvol.pro (11)', url: 'jr.maxvol.pro', settings: { key: '', parser_torrent_type: 'jackett' } },
        { base: 'maxvol_pro', shortName: 'Jac.Maxvol', name: 'Jac.Maxvol.pro', url: 'jac.maxvol.pro', settings: { key: '1', parser_torrent_type: 'jackett' } }
    ];

    function getProto() {
        return window.location.protocol === 'https:' ? 'https://' : 'http://';
    }

    function stripProxy(url) {
        if (!url) return '';
        return url.replace(PROXY_PREFIX, '');
    }

    function withProto(url) {
        if (!url) return '';
        var clean = stripProxy(url).replace(/^https?:\/\//i, '');
        return getProto() + clean;
    }

    function applyProxy(url, targetType) {
        if (!url) return '';
        var cleanUrl = stripProxy(url);
        var finalUrl = withProto(cleanUrl); 


        var proxyVal = Lampa.Storage.get('parser_use_proxy', false);
        var useProxy = (proxyVal === true || proxyVal === 'true');
        
        var currentTarget = Lampa.Storage.get('parser_proxy_target', 'both');
        var shouldHaveProxy = useProxy && (currentTarget === 'both' || currentTarget === targetType);
        
        if (shouldHaveProxy) {
            return PROXY_PREFIX + finalUrl;
        }
        return finalUrl;
    }

    function normalizeUrl(url) {
        return (url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '').trim().toLowerCase();
    }

    function getParsers() {
        var s = Lampa.Storage.get(STORAGE_PARSERS, false);
        if (typeof s === 'string') {
            try { s = JSON.parse(s); } catch (e) {}
        }
        if (s && Array.isArray(s) && s.length > 0) return s;
        return JSON.parse(JSON.stringify(DEFAULT_PARSERS));
    }

    function saveParsers(list) {
        Lampa.Storage.set(STORAGE_PARSERS, list);
    }


    function updateStandardFieldsUI() {
        setTimeout(function() {
            var j1 = Lampa.Storage.get('jackett_url', '');
            var j2 = Lampa.Storage.get('jackett_url_two', '');
            var p1 = Lampa.Storage.get('prowlarr_url', '');
            
            $('div[data-name="jackett_url"] .settings-param__value').text(j1);
            $('div[data-name="jackett_url_two"] .settings-param__value').text(j2);
            $('div[data-name="prowlarr_url"] .settings-param__value').text(p1);
        }, 50);
    }


    function refreshExistingUrls() {
        var j_url1 = Lampa.Storage.get('jackett_url', '');
        var j_url2 = Lampa.Storage.get('jackett_url_two', '');
        var p_url1 = Lampa.Storage.get('prowlarr_url', '');
        
        if (j_url1) Lampa.Storage.set('jackett_url', applyProxy(j_url1, 'primary'));
        if (p_url1) Lampa.Storage.set('prowlarr_url', applyProxy(p_url1, 'primary'));
        if (j_url2) Lampa.Storage.set('jackett_url_two', applyProxy(j_url2, 'secondary'));
    }


    function translate() {
        Lampa.Lang.add({
            bat_parser: { en: 'Parsers catalog', uk: 'Каталог парсерів', zh: '解析器目录' },
            bat_parser_description: { en: 'Click to select a parser from', uk: 'Натисніть для вибору парсера з', zh: '点击从目录中选择解析器' },
            bat_parser_current: { en: 'Current selection:', uk: 'Поточний вибір:', zh: '当前选择：' },
            bat_parser_none: { en: 'Not selected', uk: 'Не вибрано', zh: '未选择' },
            bat_parser_selected_label: { en: 'Selected:', uk: 'Обрано:', zh: '已选择：' },
            bat_check_parsers: { en: 'Check parsers availability', uk: 'Перевірити доступність парсерів', zh: '检查解析器可用性' },
            bat_check_parsers_desc: { en: 'Checks parsers availability', uk: 'Виконує перевірку доступності парсерів', zh: '执行解析器可用性检查' },
            bat_check_search: { en: 'Check search availability', uk: 'Перевірити доступність пошуку', zh: '检查搜索可用性' },
            bat_check_search_desc: { en: 'Checks torrent search availability', uk: 'Виконує перевірку доступності пошуку торентів', zh: '执行种子搜索可用性检查' },
            bat_check_done: { en: 'Check completed', uk: 'Перевірку завершено', zh: '检查完成' },
            bat_status_checking_server: { en: 'Checking server…', uk: 'Перевірка сервера…', zh: '检查服务器…' },
            bat_status_server_ok: { en: 'Server available', uk: 'Сервер доступний', zh: '服务器可用' },
            bat_status_server_warn: { en: 'Server responds (restrictions)', uk: 'Сервер відповідає (обмеження)', zh: '服务器有响应（受限）' },
            bat_status_server_bad: { en: 'Server unavailable', uk: 'Сервер недоступний', zh: '服务器不可用' },
            bat_status_unknown: { en: 'Unchecked', uk: 'Не перевірено', zh: '未检查' },
            bat_status_checking_search: { en: 'Checking search…', uk: 'Перевірка пошуку…', zh: '检查搜索…' },
            bat_status_search_ok: { en: 'Search works', uk: 'Пошук працює', zh: '搜索可用' },
            bat_status_search_bad: { en: 'Search does not work', uk: 'Пошук не працює', zh: '搜索不可用' },
            
            bat_parser_proxy: { en: 'Enable proxy', uk: 'Включити проксі', zh: '启用代理' },
            bat_parser_proxy_desc: { en: 'Adds a proxy before the parser URL', uk: 'Додає проксі перед адресою парсера', zh: '在解析器URL前添加代理' },
            
            bat_parser_proxy_target: { en: 'Proxy target', uk: 'Для якого парсера (проксі)', zh: '代理目标' },
            bat_parser_proxy_target_desc: { en: 'Select which parser will use the proxy', uk: 'Оберіть, до якої адреси додавати проксі', zh: '选择使用代理的解析器' }
        });
    }

    var COLOR_OK = '#1aff00';
    var COLOR_BAD = '#ff2e36';
    var COLOR_WARN = '#f3d900';
    var COLOR_UNKNOWN = '#8c8c8c';

    var cache = {
        data: {}, 
        ttlHealth: 30 * 1000, 
        ttlSearch: 15 * 60 * 1000,
        get: function (key) { 
            var v = this.data[key]; 
            if (v && Date.now() < v.expiresAt) return v; 
            return null; 
        },
        set: function (key, value, ttl) { 
            this.data[key] = { value: value, expiresAt: Date.now() + ttl }; 
        }
    };

    function notifyDone() {
        var text = Lampa.Lang.translate('bat_check_done');
        try { 
            if (Lampa.Noty && typeof Lampa.Noty.show === 'function') { Lampa.Noty.show(text); return; }
            if (Lampa.Toast && typeof Lampa.Toast.show === 'function') { Lampa.Toast.show(text); return; } 
        } catch (e) {}
        alert(text);
    }

    function getSelectedBase() { 
        return Lampa.Storage.get(STORAGE_PRI_ACT, NO_PARSER); 
    }

    function getParserByBase(base) {
        var list = getParsers();
        return list.find(function (p) { return p.base === base; });
    }

    function applySelectedParser(base) {
        if (!base || base === NO_PARSER) return false;
        var p = getParserByBase(base);
        if (!p || !p.settings) return false;

        var type = p.settings.parser_torrent_type || 'jackett';
        var finalUrl = applyProxy(p.url, 'primary'); 

        Lampa.Storage.set(type === 'prowlarr' ? 'prowlarr_url' : 'jackett_url', finalUrl);
        Lampa.Storage.set(type === 'prowlarr' ? 'prowlarr_key' : 'jackett_key', p.settings.key || '');
        Lampa.Storage.set('parser_torrent_type', type);
        return true;
    }

    function updateSelectedLabelInSettings() {
        var base = getSelectedBase();
        var parser = getParserByBase(base);
        var name = parser ? parser.name : Lampa.Lang.translate('bat_parser_none');
        $('.bat-parser-selected').text(Lampa.Lang.translate('bat_parser_selected_label') + " " + name);
    }

    function protocolCandidatesFor(url) {
        if (/^https?:\/\//i.test(url)) return [''];
        return ['https://', 'http://'];
    }

    function ajaxTryUrls(urls, timeout) {
        return new Promise(function (resolve) {
            var idx = 0;
            function attempt() {
                if (idx >= urls.length) { resolve({ ok: false, xhr: null, url: null, network: true }); return; }
                var url = urls[idx++];
                $.ajax({
                    url: url, method: 'GET', timeout: timeout,
                    success: function (data, textStatus, xhr) { resolve({ ok: true, xhr: xhr, url: url, data: data }); },
                    error: function (xhr) {
                        var status = xhr && typeof xhr.status === 'number' ? xhr.status : 0;
                        if (status === 0) attempt(); else resolve({ ok: false, xhr: xhr, url: url, network: false });
                    }
                });
            }
            attempt();
        });
    }

    function healthUrlCandidates(parser) {
        var key = encodeURIComponent((parser.settings && parser.settings.key) || '');
        var type = (parser.settings && parser.settings.parser_torrent_type) || 'jackett';
        var path = (type === 'prowlarr') ? '/api/v1/health?apikey=' + key : '/api/v2.0/indexers/status:healthy/results?apikey=' + key;
        
        var cleanUrl = stripProxy(parser.url); 
        var protos = protocolCandidatesFor(cleanUrl);
        
        return protos.map(function (p) { 
            return p + cleanUrl + path; 
        });
    }

    function runHealthChecks(parsers) {
        var map = {};
        var requests = parsers.map(function (parser) {
            return new Promise(function (resolve) {
                var urls = healthUrlCandidates(parser);
                var cacheKey = 'health::' + parser.base + '::direct::' + urls.join('|');
                var cached = cache.get(cacheKey);
                if (cached) { map[parser.base] = cached.value; resolve(); return; }

                ajaxTryUrls(urls, 5000).then(function (res) {
                    var val;
                    if (res.ok) val = { color: COLOR_OK, labelKey: 'bat_status_server_ok' };
                    else if (res.network === false) val = { color: COLOR_WARN, labelKey: 'bat_status_server_warn' };
                    else val = { color: COLOR_BAD, labelKey: 'bat_status_server_bad' };
                    map[parser.base] = val; cache.set(cacheKey, val, cache.ttlHealth); resolve();
                });
            });
        });
        return Promise.all(requests).then(function () { return map; });
    }

    function deepSearchUrlCandidates(parser, query) {
        var key = encodeURIComponent((parser.settings && parser.settings.key) || '');
        var path = '/api/v2.0/indexers/all/results?apikey=' + key + '&Query=' + encodeURIComponent(query) + '&Category=2000';
        
        var cleanUrl = stripProxy(parser.url);
        var protos = protocolCandidatesFor(cleanUrl);
        
        return protos.map(function (p) { 
            return p + cleanUrl + path; 
        });
    }

    function runDeepSearchChecks(parsers) {
        var map = {};
        var SAFE_QUERIES = ['1080p', 'bluray', 'x264', '2022'];
        var query = SAFE_QUERIES[Math.floor(Math.random() * SAFE_QUERIES.length)];

        var requests = parsers.map(function (parser) {
            return new Promise(function (resolve) {
                var urls = deepSearchUrlCandidates(parser, query);
                var cacheKey = 'search::' + parser.base + '::direct';
                var cached = cache.get(cacheKey);
                if (cached) { map[parser.base] = cached.value; resolve(); return; }

                ajaxTryUrls(urls, 6000).then(function (res) {
                    var val = res.ok ? { color: COLOR_OK, labelKey: 'bat_status_search_ok' } : { color: COLOR_BAD, labelKey: 'bat_status_search_bad' };
                    map[parser.base] = val; cache.set(cacheKey, val, cache.ttlSearch); resolve();
                });
            });
        });
        return Promise.all(requests).then(function () { return map; });
    }

    function injectStyleOnce() {
        if (window.__bat_parser_modal_style__) return;
        window.__bat_parser_modal_style__ = true;
        
        var css = 
            ".bat-parser-modal{display:flex;flex-direction:column;gap:1em}\n" +
            ".bat-parser-modal__head{display:flex;align-items:center;justify-content:space-between;gap:1em}\n" +
            ".bat-parser-modal__current-label{font-size:.9em;opacity:.7}\n" +
            ".bat-parser-modal__current-value{font-size:1.1em}\n" +
            ".bat-parser-modal__list{display:flex;flex-direction:column;gap:.6em}\n" +
            ".bat-parser-modal__item{display:flex;align-items:center;justify-content:space-between;gap:1em;padding:.8em 1em;border-radius:.7em;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)}\n" +
            ".bat-parser-modal__item.is-selected,.bat-parser-modal__item.focus{border-color:#fff}\n" +
            ".bat-parser-modal__left{display:flex;align-items:center;gap:.65em;min-width:0}\n" +
            ".bat-parser-modal__dot{width:.55em;height:.55em;border-radius:50%;background:" + COLOR_UNKNOWN + ";box-shadow:0 0 .6em rgba(0,0,0,.35);flex:0 0 auto}\n" +
            ".bat-parser-modal__name{font-size:1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n" +
            ".bat-parser-modal__status{font-size:.85em;opacity:.75;text-align:right;flex:0 0 auto}\n" +
            ".bat-parser-modal__actions{display:flex;gap:.6em;flex-wrap:wrap}\n" +
            ".bat-parser-modal__action{padding:.55em .9em;border-radius:.6em;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2)}\n" +
            ".bat-parser-modal__action.focus{border-color:#fff}";
            
        var style = document.createElement('style'); 
        style.type = 'text/css'; 
        style.appendChild(document.createTextNode(css)); 
        document.head.appendChild(style);
    }

    function buildParserItem(base, name) {
        var item = $("<div class='bat-parser-modal__item selector' data-base='" + base + "'><div class='bat-parser-modal__left'><span class='bat-parser-modal__dot'></span><div class='bat-parser-modal__name'></div></div><div class='bat-parser-modal__status'></div></div>");
        item.find('.bat-parser-modal__name').text(name);
        item.find('.bat-parser-modal__status').text(Lampa.Lang.translate('bat_status_unknown'));
        return item;
    }

    function setItemStatus(item, color, labelKey) {
        item.find('.bat-parser-modal__dot').css('background-color', color);
        item.find('.bat-parser-modal__status').text(Lampa.Lang.translate(labelKey));
    }

    function applySelection(list, base) {
        list.find('.bat-parser-modal__item').removeClass('is-selected');
        list.find("[data-base='" + base + "']").addClass('is-selected');
    }

    function updateCurrentLabel(wrapper, base) {
        var parser = getParserByBase(base);
        wrapper.find('.bat-parser-modal__current-value').text(parser ? parser.name : Lampa.Lang.translate('bat_parser_none'));
    }

    function openParserModal() {
        injectStyleOnce();
        var selected = getSelectedBase();
        var listData = getParsers();

        var modal = $("<div class='bat-parser-modal'><div class='bat-parser-modal__head'><div class='bat-parser-modal__current'><div class='bat-parser-modal__current-label'></div><div class='bat-parser-modal__current-value'></div></div></div><div class='bat-parser-modal__list'></div><div class='bat-parser-modal__actions'></div></div>");
        modal.find('.bat-parser-modal__current-label').text(Lampa.Lang.translate('bat_parser_current'));
        updateCurrentLabel(modal, selected);

        var list = modal.find('.bat-parser-modal__list');
        var noneItem = buildParserItem(NO_PARSER, Lampa.Lang.translate('bat_parser_none'));
        
        noneItem.on('hover:enter', function () {
            Lampa.Storage.set(STORAGE_PRI_ACT, NO_PARSER); 
            applySelection(list, NO_PARSER); 
            updateCurrentLabel(modal, NO_PARSER); 
            updateSelectedLabelInSettings();
        });
        list.append(noneItem);

        listData.forEach(function (p) {
            var item = buildParserItem(p.base, p.name);
            item.on('hover:enter', function () {
                Lampa.Storage.set(STORAGE_PRI_ACT, p.base); 
                applySelectedParser(p.base); 
                applySelection(list, p.base); 
                updateCurrentLabel(modal, p.base); 
                updateSelectedLabelInSettings();
                updateStandardFieldsUI();
            });
            list.append(item);
        });

        applySelection(list, selected);

        var actions = modal.find('.bat-parser-modal__actions');
        var btnHealth = $("<div class='bat-parser-modal__action selector'></div>").text(Lampa.Lang.translate('bat_check_parsers'));
        var btnSearch = $("<div class='bat-parser-modal__action selector'></div>").text(Lampa.Lang.translate('bat_check_search'));
        actions.append(btnHealth).append(btnSearch);

        function applyMapToList(statusMap) {
            list.find('.bat-parser-modal__item').each(function () {
                var it = $(this); var base = it.data('base');
                if (base === NO_PARSER) { setItemStatus(it, COLOR_UNKNOWN, 'bat_status_unknown'); return; }
                var st = statusMap[base];
                if (!st) setItemStatus(it, COLOR_UNKNOWN, 'bat_status_unknown'); else setItemStatus(it, st.color, st.labelKey);
            });
        }

        function runHealthUI() {
            list.find('.bat-parser-modal__item').each(function () {
                var it = $(this); if (it.data('base') === NO_PARSER) setItemStatus(it, COLOR_UNKNOWN, 'bat_status_unknown'); else setItemStatus(it, COLOR_WARN, 'bat_status_checking_server');
            });
            return runHealthChecks(listData).then(function (map) { applyMapToList(map); notifyDone(); });
        }

        function runSearchUI() {
            list.find('.bat-parser-modal__item').each(function () {
                var it = $(this); if (it.data('base') === NO_PARSER) return; setItemStatus(it, COLOR_WARN, 'bat_status_checking_search');
            });
            return runDeepSearchChecks(listData).then(function (map) { applyMapToList(map); notifyDone(); });
        }

        btnHealth.on('hover:enter', runHealthUI);
        btnSearch.on('hover:enter', runSearchUI);

        var firstSelectable = list.find('.bat-parser-modal__item').first();
        Lampa.Modal.open({
            title: Lampa.Lang.translate('bat_parser'), html: modal, size: 'medium', scroll_to_center: true, select: firstSelectable,
            onBack: function () { Lampa.Modal.close(); Lampa.Controller.toggle('settings_component'); }
        });

        runHealthUI();
    }

    function initPrimarySettings() {
        applySelectedParser(getSelectedBase());
        
        Lampa.SettingsApi.addParam({
            component: 'parser', param: { name: 'bat_parser_manage', type: 'button' },
            field: {
                name: Lampa.Lang.translate('bat_parser'),
                description: Lampa.Lang.translate('bat_parser_description') + " " + getParsers().length + "<div class='bat-parser-selected' style='margin-top:.35em;opacity:.85'></div>"
            },
            onChange: openParserModal,
            onRender: function (item) {
                setTimeout(function () {
                    if (Lampa.Storage.field('parser_use')) item.show(); else item.hide();
                    $('.settings-param__name', item).css('color', COLOR_WARN);
                    updateSelectedLabelInSettings();
                    var parserUse = $('div[data-name="parser_use"]').first();
                    if (parserUse.length) item.insertAfter(parserUse);
                });
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'parser',
            param: { name: 'parser_use_proxy', type: 'trigger', default: false },
            field: {
                name: Lampa.Lang.translate('bat_parser_proxy'),
                description: Lampa.Lang.translate('bat_parser_proxy_desc')
            },
            onChange: function () {
                refreshExistingUrls();
                Lampa.Settings.update();
            },
            onRender: function (item) {
                setTimeout(function () {
                    if (Lampa.Storage.field('parser_use')) item.show(); else item.hide();
                    var manageBtn = $('div[data-name="bat_parser_manage"]').first();
                    if (manageBtn.length) item.insertAfter(manageBtn);
                }, 10);
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'parser',
            param: {
                name: 'parser_proxy_target',
                type: 'select',
                values: {
                    primary: 'Тільки для основного',
                    secondary: 'Тільки для додаткового',
                    both: 'Для обох (Основний + Додатковий)'
                },
                default: 'both'
            },
            field: {
                name: Lampa.Lang.translate('bat_parser_proxy_target'),
                description: Lampa.Lang.translate('bat_parser_proxy_target_desc')
            },
            onChange: function () {
                refreshExistingUrls();
                Lampa.Settings.update();
            },
            onRender: function (item) {
                setTimeout(function () {
                    var proxyVal = Lampa.Storage.get('parser_use_proxy', false);
                    var isProxyOn = (proxyVal === true || proxyVal === 'true');
                    
                    if (Lampa.Storage.field('parser_use') && isProxyOn) {
                        item.show();
                    } else {
                        item.hide();
                    }
                    var proxyBtn = $('div[data-name="parser_use_proxy"]').first();
                    if (proxyBtn.length) item.insertAfter(proxyBtn);
                }, 10);
            }
        });
    }


    function applySecondaryParser(idx) {
        var list = getParsers();
        var p = list[idx];
        if (!p) return;

        var finalUrl = applyProxy(p.url, 'secondary');

        Lampa.Storage.set('jackett_url_two', finalUrl);
        Lampa.Storage.set('jackett_key_two', (p.settings && p.settings.key) || '');
        Lampa.Storage.set('parser_use_link', 'both');
    }

    function activeShortName() {
        var currentUrl = Lampa.Storage.get('jackett_url_two', '');
        if (!currentUrl) return '—';

        var normCurrent = normalizeUrl(stripProxy(currentUrl));
        var list = getParsers();

        for (var i = 0; i < list.length; i++) {
            var normListUrl = normalizeUrl(stripProxy(list[i].url));
            var normDisplayUrl = normalizeUrl(stripProxy(list[i].displayUrl));
            
            if (normListUrl === normCurrent || (normDisplayUrl && normDisplayUrl === normCurrent)) {
                Lampa.Storage.set(STORAGE_SEC_ACT, i);
                return list[i].shortName || list[i].name;
            }
        }
        
        return 'Ручне нал.'; 
    }

    function reloadTorrents() {
        var a = Lampa.Activity.active();
        if (!a || a.component !== 'torrents') return;
        Lampa.Activity.replace({
            component: 'torrents', url: a.url, title: a.title, search: a.search, search_one: a.search_one, search_two: a.search_two, movie: a.movie, page: 1, params: a.params
        });
    }

    var ICON = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:1.4em;height:1.4em;min-width:1.4em;min-height:1.4em;vertical-align:middle;fill:currentColor;flex-shrink:0"><use xlink:href="#sprite-folder"></use></svg>';

    function buildSecondaryButton() {
        var btn = $('<div class="simple-button simple-button--filter selector filter--parser">' + ICON + '<div class="ps-name">' + activeShortName() + '</div></div>');
        btn.on('hover:enter click', function () { openSecondarySelectMenu(btn); });
        return btn;
    }

    function updateBtnName(btn) { 
        btn.find('.ps-name').text(activeShortName()); 
    }

    function tryInjectSecondaryButton(torrentFilter) {
        if (torrentFilter.find('.filter--parser').length) return;
        var btn = buildSecondaryButton();
        var search = torrentFilter.find('.filter--search');
        if (search.length) btn.insertAfter(search);
        else {
            var sort = torrentFilter.find('.filter--sort');
            if (sort.length) btn.insertBefore(sort); else torrentFilter.prepend(btn);
        }
    }

    function openSecondarySelectMenu(btn) {
        var list = getParsers();
        var currentUrl = normalizeUrl(stripProxy(Lampa.Storage.get('jackett_url_two', '')));
        var active = -1;
        
        for (var i = 0; i < list.length; i++) {
            if (normalizeUrl(stripProxy(list[i].url)) === currentUrl || normalizeUrl(stripProxy(list[i].displayUrl)) === currentUrl) {
                active = i; break;
            }
        }

        var enabled = Lampa.Controller.enabled().name;

        var items = list.map(function (p, i) {
            var sub = p.displayUrl ? p.displayUrl : withProto(stripProxy(p.url));
            if (p.settings && p.settings.key) sub += '  |  apikey: ' + p.settings.key;
            
            var dotHtml = '<span class="sec-dot" data-base="' + p.base + '" style="display:inline-block; width:0.55em; height:0.55em; border-radius:50%; background-color:' + COLOR_WARN + '; margin-right:0.6em; box-shadow:0 0 0.6em rgba(0,0,0,0.35); vertical-align:middle;"></span>';
            
            return { 
                title: dotHtml + p.name, 
                subtitle: sub, 
                selected: i === active, 
                myIdx: i 
            };
        });
        
        items.push({ title: 'Керування парсерами…', manage: true });

        Lampa.Select.show({
            title: 'Вибір додаткового парсера', items: items,
            onSelect: function (item) {
                if (item.manage) openManageMenu(btn, enabled);
                else {
                    Lampa.Storage.set(STORAGE_SEC_ACT, item.myIdx);
                    applySecondaryParser(item.myIdx); 
                    updateBtnName(btn);
                    Lampa.Noty.show('Парсер: ' + activeShortName());
                    Lampa.Controller.toggle(enabled); 
                    reloadTorrents();
                }
            },
            onBack: function () { Lampa.Controller.toggle(enabled); }
        });

        runHealthChecks(list).then(function (map) {
            list.forEach(function(p) {
                var st = map[p.base];
                var color = st ? st.color : COLOR_UNKNOWN;
                $('.sec-dot[data-base="' + p.base + '"]').css('background-color', color);
            });
        });
    }

    function openManageMenu(btn, enabled) {
        var list = getParsers();
        var items = list.map(function (p, i) {
            var sub = p.displayUrl ? p.displayUrl : withProto(stripProxy(p.url));
            if (p.settings && p.settings.key) sub += '  |  apikey: ' + p.settings.key;
            return { title: p.name, subtitle: sub, myIdx: i };
        });
        
        items.push({ title: '+ Додати парсер', add: true });
        items.push({ title: 'Скинути за замовчуванням', reset: true });

        Lampa.Select.show({
            title: 'Керування парсерами', items: items,
            onSelect: function (item) {
                if (item.add) {
                    inputDialog('Повна назва', '', function (name) {
                        if (!name) return;
                        setTimeout(function() { 
                            inputDialog('Коротка назва (для кнопки)', name, function (shortName) {
                                setTimeout(function() {
                                    inputDialog('URL (без протоколу, наприклад: jac.red)', '', function (url) {
                                        setTimeout(function() {
                                            inputDialog('API-ключ (або залиште порожнім)', '', function (key) {
                                                var l = getParsers();
                                                var cleanUrl = stripProxy(url || '').trim().replace(/^https?:\/\//i, '');
                                                l.push({ 
                                                    base: 'base_' + Date.now(), 
                                                    name: name.trim(), 
                                                    shortName: (shortName || name).trim(), 
                                                    url: cleanUrl, 
                                                    settings: { key: (key || '').trim(), parser_torrent_type: 'jackett' } 
                                                });
                                                saveParsers(l);
                                                Lampa.Noty.show('Додано: ' + name.trim()); 
                                                Lampa.Controller.toggle(enabled);
                                            });
                                        }, 350);
                                    });
                                }, 350);
                            });
                        }, 350);
                    });
                } else if (item.reset) {
                    saveParsers(DEFAULT_PARSERS);
                    Lampa.Storage.set(STORAGE_SEC_ACT, 0);
                    updateBtnName(btn);
                    Lampa.Noty.show('Список відновлено');
                    Lampa.Controller.toggle(enabled);
                } else {
                    editMenu(item.myIdx, btn, enabled);
                }
            },
            onBack: function () { Lampa.Controller.toggle(enabled); }
        });
    }

    function editMenu(idx, btn, enabled) {
        var list = getParsers();
        var p = list[idx];
        Lampa.Select.show({
            title: p.name,
            items: [ 
                { title: 'Змінити URL', action: 'url' }, 
                { title: 'Змінити API-ключ', action: 'apikey' }, 
                { title: 'Перейменувати', action: 'rename' }, 
                { title: 'Видалити', action: 'delete' } 
            ],
            onSelect: function (item) {
                if (item.action === 'delete') {
                    list.splice(idx, 1); 
                    saveParsers(list);
                    updateBtnName(btn); 
                    Lampa.Noty.show('Видалено'); 
                    Lampa.Controller.toggle(enabled);
                } else if (item.action === 'url') {
                    inputDialog('Новий URL (без протоколу)', stripProxy(p.url), function (val) {
                        list[idx].url = stripProxy(val || '').trim().replace(/^https?:\/\//i, '');
                        if (list[idx].displayUrl) delete list[idx].displayUrl;
                        saveParsers(list); 
                        updateBtnName(btn);
                        Lampa.Noty.show('URL оновлено'); 
                        Lampa.Controller.toggle(enabled);
                    });
                } else if (item.action === 'apikey') {
                    inputDialog('API-ключ', (p.settings && p.settings.key) || '', function (val) {
                        if (!list[idx].settings) list[idx].settings = {};
                        list[idx].settings.key = (val || '').trim(); 
                        saveParsers(list);
                        updateBtnName(btn);
                        Lampa.Noty.show('API-ключ оновлено'); 
                        Lampa.Controller.toggle(enabled);
                    });
                } else if (item.action === 'rename') {
                    inputDialog('Нова повна назва', p.name, function (nameVal) {
                        if (!nameVal) return;
                        setTimeout(function() { 
                            inputDialog('Нова коротка назва', p.shortName || nameVal, function (shortVal) {
                                list[idx].name = nameVal.trim(); 
                                list[idx].shortName = (shortVal || nameVal).trim();
                                saveParsers(list); 
                                updateBtnName(btn);
                                Lampa.Noty.show('Перейменовано'); 
                                Lampa.Controller.toggle(enabled);
                            });
                        }, 350);
                    });
                }
            },
            onBack: function () { Lampa.Controller.toggle(enabled); }
        });
    }

    function inputDialog(title, value, cb) {
        if (Lampa.Input && typeof Lampa.Input.edit === 'function') {
            Lampa.Input.edit({
                title: title,
                value: value || '',
                free: true,
                nosave: true
            }, function (new_val) {
                cb(new_val);
            });
        } else {
            var res = prompt(title, value || '');
            if (res !== null) cb(res);
        }
    }

    var secondaryObserver = null;

    function startSecondaryObserver() {
        if (secondaryObserver) return;
        secondaryObserver = new MutationObserver(function () {
            var activity = Lampa.Activity.active();
            if (activity && activity.component !== 'torrents') return;
            
            var el = $('.torrent-filter');
            if (el.length && !el.find('.filter--parser').length) {
                tryInjectSecondaryButton(el);
            }
        });
        secondaryObserver.observe(document.body, { childList: true, subtree: true });
    }

    function stopSecondaryObserver() {
        if (secondaryObserver) {
            secondaryObserver.disconnect();
            secondaryObserver = null;
        }
    }


    function initSecondaryPlugin() {
        var isFixingUrl = false;
        
        Lampa.Storage.listener.follow('change', function (e) {
            if (!isFixingUrl && (e.name === 'jackett_url' || e.name === 'jackett_url_two' || e.name === 'prowlarr_url')) {
                var targetType = (e.name === 'jackett_url_two') ? 'secondary' : 'primary';
                if (e.value) {
                    var expectedUrl = applyProxy(e.value, targetType);
                    if (expectedUrl !== e.value) {
                        isFixingUrl = true;
                        Lampa.Storage.set(e.name, expectedUrl);
                        updateStandardFieldsUI();
                        setTimeout(function(){ isFixingUrl = false; }, 150);
                    }
                }
            }
            
            if (e.name === 'activity') {
                var activity = Lampa.Activity.active();
                if (activity && activity.component === 'torrents') {
                    startSecondaryObserver();
                    setTimeout(function() {
                        var el = $('.torrent-filter');
                        if (el.length) tryInjectSecondaryButton(el);
                    }, 100);
                    setTimeout(function() {
                        var el = $('.torrent-filter');
                        if (el.length) tryInjectSecondaryButton(el);
                    }, 800);
                } else {
                    stopSecondaryObserver();
                }
            }
        });

        var activity = Lampa.Activity.active();
        if (activity && activity.component === 'torrents') {
            startSecondaryObserver();
            var el = $('.torrent-filter');
            if (el.length) tryInjectSecondaryButton(el);
        }
    }


    function initAll() {
        Lampa.Lang.add = Lampa.Lang.add || function() {};
        translate();
        initPrimarySettings();
        initSecondaryPlugin();
        console.log('[CombinedParserPlugin V12 - Ultimate Sync] Loaded successfully');
    }

    if (!window.plugin_combined_parser_ready) {
        window.plugin_combined_parser_ready = true;
        if (window.appready || (window.Lampa && window.Lampa.Storage)) initAll();
        else {
            document.addEventListener('lampa:ready', initAll);
            if (window.Lampa && window.Lampa.Listener) Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') initAll(); });
        }
    }

})();
