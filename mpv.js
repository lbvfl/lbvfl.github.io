(function () {
    'use strict';

    // --- ПЕРЕВІРКА ПЛАТФОРМИ ТА МОДУЛІВ NODE.JS / ELECTRON ---
    var isWindows = navigator.platform.indexOf('Win') > -1 || navigator.userAgent.indexOf('Windows') > -1;
    var req = window.require || window.nodeRequire;
    var node_cp = null;
    var node_fs = null;
    var node_net = null;
    var node_os = null;
    var node_path = null;

    if (isWindows && req) {
        try { node_cp = req('child_process'); } catch (e) {}
        try { node_fs = req('fs'); } catch (e) {}
        try { node_net = req('net'); } catch (e) {}
        try { node_os = req('os'); } catch (e) {}
        try { node_path = req('path'); } catch (e) {}
    }

    if (!isWindows || !node_cp) {
        console.log('PC Players Plugin: Запуск скасовано. Немає child_process або це не Windows.');
        return;
    }

    var localAppData = (typeof process !== 'undefined' && process.env && process.env.LOCALAPPDATA) ? process.env.LOCALAPPDATA : 'C:\\Users\\user\\AppData\\Local';

    // Декодування бінарних / буферних даних stdout
    function decodeChunk(chunk) {
        if (typeof chunk === 'string') return chunk;
        if (chunk instanceof Uint8Array || ArrayBuffer.isView(chunk)) {
            try { return new TextDecoder('utf-8').decode(chunk); } catch (e) {}
        }
        return String(chunk);
    }

    // --- КАНДИДАТИ ШЛЯХІВ ДО MPV ---
    function getMpvCandidates() {
        return [
            (window.Lampa && Lampa.Storage) ? Lampa.Storage.get('player_mpv_path', '') : '',
            (window.Lampa && Lampa.Storage && (Lampa.Storage.get('player_nw_path', '').toLowerCase().indexOf('mpv') > -1)) ? Lampa.Storage.get('player_nw_path', '') : '',
            'C:\\mpv\\mpv.exe',   
        ].filter(Boolean);
    }

    // --- СИСТЕМНІ ЗМІННІ ---
    var pollingInterval = null;
    var isPlaying = false;
    var mpvSocket = null;
    var mpvConnectRetries = 0;
    var mpvConnectTimeout = null;
    var activePlaylistEpisodes = [];
    var currentTrackIndex = 0;
    var activePlaylistFile = null;
    var lastReportedTime = -1;
    var lastReportedDuration = -1;
    var activeMediaCard = null;

    // Спливаючі сповіщення (Toast)
    function showToast(msg) {
        var toast = document.createElement('div');
        toast.innerText = msg;
        toast.style.cssText = 'position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%); background: rgba(40, 40, 40, 0.95); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; padding: 10px 22px; border-radius: 20px; z-index: 99999; font-size: 14px; opacity: 0; transition: opacity 0.3s ease; box-shadow: 0 6px 16px rgba(0,0,0,0.5); pointer-events: none; font-family: sans-serif; text-align: center;';
        document.body.appendChild(toast);

        void toast.offsetWidth;
        toast.style.opacity = '1';

        setTimeout(function() {
            toast.style.opacity = '0';
            setTimeout(function() {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 400);
        }, 2200);
    }

    function stopPolling() {
        if (currentTrackIndex >= 0 && activePlaylistEpisodes[currentTrackIndex] && lastReportedTime >= 0) {
            updateEpisodeTimeline(currentTrackIndex, lastReportedTime, lastReportedDuration);
            if (window.lampac_timecodes_sync && typeof window.lampac_timecodes_sync.autoPush === 'function') {
                try { window.lampac_timecodes_sync.autoPush(); } catch (e) {}
            }
        }
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
        if (mpvConnectTimeout) {
            clearTimeout(mpvConnectTimeout);
            mpvConnectTimeout = null;
        }
        if (mpvSocket) {
            try {
                mpvSocket.removeAllListeners();
                mpvSocket.destroy();
            } catch (err) {}
            mpvSocket = null;
        }
        if (activePlaylistFile && node_fs && typeof node_fs.unlinkSync === 'function') {
            try {
                if (node_fs.existsSync(activePlaylistFile)) node_fs.unlinkSync(activePlaylistFile);
            } catch (e) {}
            activePlaylistFile = null;
        }
        isPlaying = false;
        activePlaylistEpisodes = [];
        activeMediaCard = null;
        currentTrackIndex = 0;
        lastReportedTime = -1;
        lastReportedDuration = -1;
    }

    // Оновлення таймкоду конкретної серії в Lampa
    function updateEpisodeTimeline(trackIndex, curSec, durSec) {
        if (typeof trackIndex !== 'number' || trackIndex < 0) return;
        var ep = activePlaylistEpisodes[trackIndex];
        if (!ep) return;

        var percent = (durSec > 0) ? Math.min(100, Math.max(0, (curSec / durSec) * 100)) : 0;

        if (!ep.timeline || !ep.timeline.hash) {
            ep.timeline = resolveEpisodeTimeline(ep, ep.season, ep.episode, (typeof ep.season !== 'undefined'), activeMediaCard, null);
        }
        if (!ep.timeline.hash) {
            var c = activeMediaCard || {};
            var t = c.original_name || c.original_title || c.name || c.title || 'media';
            if (typeof ep.season !== 'undefined' && typeof ep.episode !== 'undefined' && window.Lampa && Lampa.Utils) {
                ep.timeline.hash = Lampa.Utils.hash([ep.season, ep.season > 10 ? ':' : '', ep.episode, t].join(''));
            } else {
                ep.timeline.hash = (c && c.id) ? String(c.id) : (window.Lampa && Lampa.Utils ? Lampa.Utils.hash(t) : 'media');
            }
        }

        ep.timeline.time = Math.floor(curSec);
        if (durSec > 0) {
            ep.timeline.duration = Math.floor(durSec);
            ep.timeline.percent = Math.floor(percent);
        }

        if (window.Lampa && Lampa.Timeline) {
            if (typeof Lampa.Timeline.update === 'function') {
                Lampa.Timeline.update(ep.timeline);
            }
            if (typeof Lampa.Timeline.render === 'function') {
                Lampa.Timeline.render(ep.timeline);
            }
        }

        if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.send === 'function') {
            Lampa.Listener.send('timeline', { type: 'update', data: ep.timeline });
        }
    }

    // Очищення та нормалізація URL
    function sanitizeVideoUrl(url) {
        if (typeof url !== 'string' || !url) return url;
        var res = url;
        if (!/^https?:\/\//i.test(res) && res.indexOf('http') !== -1) {
            var match = res.match(/(https?[:\\]{1,3}[^\s"']+)/i);
            if (match) res = match[1];
        }
        res = res.replace(/\\/g, '/');
        res = res.replace(/(https?:\/)(?!\/)/i, '$1/');
        return res;
    }

    // Отримання збереженого таймкоду з хешів Lampa
    function resolveEpisodeTimeline(item, s, e, isSeries, card, defData) {
        if (item && item.timeline && item.timeline.hash) {
            return item.timeline;
        }
        if (defData && defData.timeline && defData.timeline.hash && (!item || item === defData)) {
            return defData.timeline;
        }

        var itemHash = (item && (item.hash_file || item.hash)) || (defData && (defData.hash_file || defData.hash));
        if (itemHash && window.Lampa && Lampa.Timeline && typeof Lampa.Timeline.view === 'function') {
            var v = Lampa.Timeline.view(itemHash);
            v.hash = itemHash;
            return v;
        }

        var c = card || activeMediaCard || (window.Lampa && Lampa.Activity && Lampa.Activity.active ? (Lampa.Activity.active().card || Lampa.Activity.active().movie) : null) || {};
        var titles = [];
        if (c.original_name) titles.push(c.original_name);
        if (c.original_title) titles.push(c.original_title);
        if (c.name) titles.push(c.name);
        if (c.title) titles.push(c.title);
        if (defData && defData.original_name) titles.push(defData.original_name);
        if (defData && defData.original_title) titles.push(defData.original_title);
        if (defData && defData.name) titles.push(defData.name);
        if (defData && defData.title) titles.push(defData.title);
        if (titles.length === 0) titles.push('media');

        if (isSeries && typeof s !== 'undefined' && typeof e !== 'undefined' && window.Lampa && Lampa.Utils) {
            var sHashes = [];
            for (var i = 0; i < titles.length; i++) {
                var t = titles[i];
                if (!t) continue;
                sHashes.push(Lampa.Utils.hash([s, s > 10 ? ':' : '', e, t].join('')));
                sHashes.push(Lampa.Utils.hash([s, e, t].join('')));
            }
            if (Lampa.Timeline && typeof Lampa.Timeline.view === 'function') {
                for (var h = 0; h < sHashes.length; h++) {
                    var sv = Lampa.Timeline.view(sHashes[h]);
                    if (sv && (sv.time > 0 || sv.percent > 0)) {
                        sv.hash = sHashes[h];
                        return sv;
                    }
                }
            }
            var sPrimary = sHashes[0];
            var sTl = (Lampa.Timeline && typeof Lampa.Timeline.view === 'function') ? Lampa.Timeline.view(sPrimary) : { percent: 0, time: 0, duration: 0 };
            sTl.hash = sPrimary;
            return sTl;
        }

        if (window.Lampa && Lampa.Utils) {
            var mHashes = [];
            for (var m = 0; m < titles.length; m++) {
                if (titles[m]) mHashes.push(Lampa.Utils.hash(titles[m]));
            }
            if (Lampa.Timeline && typeof Lampa.Timeline.view === 'function') {
                for (var mh = 0; mh < mHashes.length; mh++) {
                    var mv = Lampa.Timeline.view(mHashes[mh]);
                    if (mv && (mv.time > 0 || mv.percent > 0)) {
                        mv.hash = mHashes[mh];
                        return mv;
                    }
                }
            }
            var mPrimary = mHashes[0] || Lampa.Utils.hash('media');
            var mTl = (Lampa.Timeline && typeof Lampa.Timeline.view === 'function') ? Lampa.Timeline.view(mPrimary) : { percent: 0, time: 0, duration: 0 };
            mTl.hash = mPrimary;
            return mTl;
        }

        return (item && item.timeline) || (defData && defData.timeline) || { percent: 0, time: 0, duration: 0 };
    }

    // Витягнення прямого URL з об'єкта серії або якості
    function extractUrlFromItem(item) {
        if (!item) return '';
        if (typeof item === 'string') return sanitizeVideoUrl(item);
        if (typeof item.url === 'string' && item.url) return sanitizeVideoUrl(item.url);
        if (typeof item.file === 'string' && item.file) return sanitizeVideoUrl(item.file);
        if (typeof item.stream === 'string' && item.stream) return sanitizeVideoUrl(item.stream);
        if (typeof item.video === 'string' && item.video) return sanitizeVideoUrl(item.video);
        if (typeof item.link === 'string' && item.link) return sanitizeVideoUrl(item.link);
        if (item.quality && typeof item.quality === 'object') {
            var defQ = (window.Lampa && Lampa.Storage) ? Lampa.Storage.field('video_quality_default') : null;
            var qUrl = item.quality[defQ] || Object.values(item.quality)[0] || '';
            if (typeof qUrl === 'string' && qUrl) return sanitizeVideoUrl(qUrl);
        }
        return '';
    }

    // Розв'язання прямого URL відео (підтримка функцій-резолверів балансерів)
    function resolveSingleUrl(item, callback) {
        if (!item) return callback('');

        var direct = extractUrlFromItem(item);
        if (direct) return callback(direct);

        var urlFn = (typeof item.url === 'function') ? item.url : ((typeof item.file === 'function') ? item.file : null);
        if (urlFn) {
            var resolved = false;
            var timer = setTimeout(function () {
                if (!resolved) {
                    resolved = true;
                    callback(extractUrlFromItem(item));
                }
            }, 3000);

            try {
                urlFn(function (res) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        var u = extractUrlFromItem(res) || extractUrlFromItem(item);
                        callback(u);
                    }
                });
            } catch (e) {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    callback(extractUrlFromItem(item));
                }
            }
            return;
        }

        callback('');
    }

    // --- ПОБУДОВА ПЛЕЙЛІСТА З ПОВНИМИ ДАНИМИ (TMDB, IMDB, СЕЗОНИ, СЕРІЇ) ---
    function buildPlaylistDataAsync(data, callback) {
        var activeCard = data.card || data.movie || (window.Lampa && Lampa.Activity && Lampa.Activity.active ? (Lampa.Activity.active().card || Lampa.Activity.active().movie) : null) || {};
        activeMediaCard = activeCard;
        var showTitle = activeCard.title || activeCard.name || data.title || '';
        var origTitle = activeCard.original_title || activeCard.original_name || '';
        var tmdbId = data.tmdb_id || activeCard.tmdb_id || activeCard.id || data.id || '';
        var imdbId = data.imdb_id || activeCard.imdb_id || '';

        var isSeries = false;
        if (activeCard.type === 'tv' || activeCard.first_air_date || (activeCard.seasons && activeCard.seasons.length > 0) || activeCard.number_of_seasons) {
            isSeries = true;
        } else if (activeCard.type === 'movie' || activeCard.release_date) {
            isSeries = false;
        } else if (Array.isArray(data.playlist) && data.playlist.length > 1) {
            isSeries = true;
        } else if (data.season && data.episode && (data.season > 0 || data.episode > 0) && activeCard.type !== 'movie') {
            isSeries = (activeCard.type === 'tv');
        }

        var seasonList = [];
        var curIdx = 0;

        if (!isSeries) {
            seasonList = [data];
            curIdx = 0;
        } else {
            var rawList = [];
            if (Array.isArray(data.playlist) && data.playlist.length > 0) {
                rawList = data.playlist;
            } else if (Array.isArray(data.items) && data.items.length > 0) {
                rawList = data.items;
            } else if (Array.isArray(data.episodes) && data.episodes.length > 0) {
                rawList = data.episodes;
            } else if (window.Lampa && Lampa.PlayerPlaylist && typeof Lampa.PlayerPlaylist.get === 'function') {
                rawList = Lampa.PlayerPlaylist.get() || [];
            }
            if ((!rawList || rawList.length === 0) && window.Lampa && Lampa.Activity && Lampa.Activity.active) {
                var act = Lampa.Activity.active();
                if (act) {
                    if (Array.isArray(act.playlist) && act.playlist.length > 0) rawList = act.playlist;
                    else if (Array.isArray(act.episodes) && act.episodes.length > 0) rawList = act.episodes;
                    else if (Array.isArray(act.items) && act.items.length > 0) rawList = act.items;
                }
            }

            var curSeason = (typeof data.season !== 'undefined') ? data.season : (rawList[0] && typeof rawList[0].season !== 'undefined' ? rawList[0].season : 1);
            var curEpisodeNum = (typeof data.episode !== 'undefined') ? data.episode : null;

            if (rawList.length > 0) {
                seasonList = rawList.filter(function (it) {
                    var itS = it.season || it.s || it.season_number;
                    return (typeof itS === 'undefined' || itS == curSeason);
                });
                if (seasonList.length === 0) seasonList = rawList;
            } else {
                seasonList = [data];
            }

            for (var i = 0; i < seasonList.length; i++) {
                var it = seasonList[i];
                var itS = it.season || it.s || it.season_number;
                var itE = it.episode || it.e || it.num || it.episode_number;
                var matchUrl = (it.url && data.url && it.url === data.url);
                var matchEp = (curEpisodeNum !== null && typeof itE !== 'undefined' && itE == curEpisodeNum && (typeof itS === 'undefined' || itS == curSeason));
                var matchTitle = (it.title && data.title && it.title === data.title);
                var isSel = it.selected === true;

                if (matchUrl || matchEp || matchTitle || isSel) {
                    curIdx = i;
                    break;
                }
            }
        }

        var MAX_EPISODES = 30;
        var startIndex = 0;
        var endIndex = seasonList.length;

        if (isSeries && seasonList.length > MAX_EPISODES) {
            startIndex = Math.max(0, curIdx - Math.floor(MAX_EPISODES / 2));
            endIndex = startIndex + MAX_EPISODES;
            if (endIndex > seasonList.length) {
                endIndex = seasonList.length;
                startIndex = Math.max(0, endIndex - MAX_EPISODES);
            }
        }

        var slicedItems = seasonList.slice(startIndex, endIndex);
        var startTrackIndex = curIdx - startIndex;
        if (startTrackIndex < 0) startTrackIndex = 0;

        var resolvePromises = slicedItems.map(function (item) {
            return new Promise(function (resolve) {
                resolveSingleUrl(item, function (directUrl) {
                    if (directUrl) item._directUrl = directUrl;
                    resolve(item);
                });
            });
        });

        Promise.all(resolvePromises).then(function () {
            var episodes = [];
            var m3uLines = ['#EXTM3U'];

            var year = activeCard.year || (activeCard.release_date ? activeCard.release_date.slice(0, 4) : '') || (activeCard.first_air_date ? activeCard.first_air_date.slice(0, 4) : '') || '';
            if (!year) {
                var ym = (showTitle + ' ' + origTitle).match(/\b(19\d{2}|20\d{2})\b/);
                if (ym) year = ym[1];
            }
            var yearTag = year ? ' (' + year + ')' : '';
            var baseTitle = origTitle ? (origTitle + (showTitle && showTitle !== origTitle ? ' / ' + showTitle : '')) : showTitle;
            var primaryStreamUrl = sanitizeVideoUrl(data._directUrl || data.url || data.file || '');

            for (var k = 0; k < slicedItems.length; k++) {
                var item = slicedItems[k];
                var s = item.season || item.s || item.season_number || curSeason || 1;
                var e = item.episode || item.e || item.num || item.episode_number || (startIndex + k + 1);

                var epUrl = item._directUrl || extractUrlFromItem(item);
                if (typeof epUrl === 'string') epUrl = sanitizeVideoUrl(epUrl);
                if (!epUrl && k === startTrackIndex) epUrl = primaryStreamUrl;

                // Якщо URL не розв'язався через функцію балансера, екстраполюємо за шаблоном основного потоку
                if (!epUrl && primaryStreamUrl && isSeries) {
                    var curSNum = Number(curSeason || 1);
                    var curENum = Number(curEpisodeNum || (startIndex + startTrackIndex + 1));
                    var targetSNum = Number(s);
                    var targetENum = Number(e);

                    var curSPad = String(curSNum).padStart(2, '0');
                    var curEPad = String(curENum).padStart(2, '0');
                    var trgSPad = String(targetSNum).padStart(2, '0');
                    var trgEPad = String(targetENum).padStart(2, '0');

                    var sePattern = new RegExp('s' + curSPad + 'ep' + curEPad, 'i');
                    var epPattern = new RegExp('ep' + curEPad, 'i');

                    if (sePattern.test(primaryStreamUrl)) {
                        epUrl = primaryStreamUrl.replace(sePattern, 's' + trgSPad + 'ep' + trgEPad);
                    } else if (epPattern.test(primaryStreamUrl)) {
                        epUrl = primaryStreamUrl.replace(epPattern, 'ep' + trgEPad);
                    }
                }

                if (!epUrl && k === startTrackIndex) epUrl = primaryStreamUrl;
                if (!epUrl) continue;

                var fullTitle = '';
                var shortTitle = '';

                if (isSeries && typeof s !== 'undefined' && typeof e !== 'undefined' && Number(s) > 0 && Number(e) > 0) {
                    var sPad = String(s).padStart(2, '0');
                    var ePad = String(e).padStart(2, '0');
                    var seTag = 'S' + sPad + 'E' + ePad;
                    var epName = item.title || ('Серія ' + e);
                    fullTitle = baseTitle + ' - ' + seTag + (epName ? (' - ' + epName) : '') + (tmdbId ? (' [TMDB: ' + tmdbId + ']') : '') + (imdbId ? (' [IMDB: ' + imdbId + ']') : '');
                    shortTitle = seTag + ' - ' + epName;
                } else {
                    fullTitle = baseTitle + yearTag + (tmdbId ? (' [TMDB: ' + tmdbId + ']') : '') + (imdbId ? (' [IMDB: ' + imdbId + ']') : '');
                    shortTitle = baseTitle + yearTag;
                }

                var epTimeline = resolveEpisodeTimeline(item, s, e, isSeries, activeCard, (k === startTrackIndex ? data : null));
                var initialTime = (epTimeline && epTimeline.time > 5) ? epTimeline.time : 0;
                if (initialTime <= 0 && k === startTrackIndex && data.timeline && data.timeline.time > 5) {
                    initialTime = data.timeline.time;
                    epTimeline.time = initialTime;
                }

                var epObj = {
                    url: epUrl,
                    title: fullTitle,
                    shortTitle: shortTitle,
                    season: s,
                    episode: e,
                    timeline: epTimeline,
                    _initialTime: initialTime,
                    _resumed: (k === startTrackIndex)
                };

                episodes.push(epObj);
                m3uLines.push('#EXTINF:-1,' + fullTitle.replace(/[\r\n]/g, ' '));
                m3uLines.push(epUrl);
            }

            if (episodes.length === 0) {
                var defUrl = primaryStreamUrl || sanitizeVideoUrl(data._directUrl || data.url || data.file || '');
                if (defUrl) {
                    var defTimeline = resolveEpisodeTimeline(data, null, null, false, activeCard, data);
                    var defInitialTime = (defTimeline && defTimeline.time > 5) ? defTimeline.time : 0;
                    var defFullTitle = baseTitle + yearTag + (tmdbId ? (' [TMDB: ' + tmdbId + ']') : '') + (imdbId ? (' [IMDB: ' + imdbId + ']') : '');

                    episodes.push({
                        url: defUrl,
                        title: defFullTitle,
                        shortTitle: baseTitle + yearTag,
                        timeline: defTimeline,
                        _initialTime: defInitialTime,
                        _resumed: true
                    });
                    m3uLines.push('#EXTINF:-1,' + defFullTitle);
                    m3uLines.push(defUrl);
                    startTrackIndex = 0;
                }
            }

            callback({
                playlistFile: null,
                m3uContent: m3uLines.join('\n'),
                episodes: episodes,
                startTrackIndex: startTrackIndex,
                firstStartTime: episodes[startTrackIndex] ? episodes[startTrackIndex]._initialTime : 0
            });
        });
    }

    // Попереднє розв'язання початкового відеопотоку (для TorrServer та онлайн балансерів)
    function resolveInitialPlayData(playData, callback) {
        var direct = extractUrlFromItem(playData);
        if (direct) {
            playData._directUrl = direct;
            return callback(playData);
        }

        var isTorrent = (playData.torrent_hash || (typeof playData.url === 'string' && playData.url.indexOf(':8090') > -1) || (typeof playData.file === 'string' && playData.file.indexOf(':8090') > -1));
        if (isTorrent) {
            var torUrl = (typeof playData.url === 'string' ? playData.url : '') || (typeof playData.file === 'string' ? playData.file : '');
            if (torUrl) {
                playData._directUrl = torUrl;
                return callback(playData);
            }
        }

        var urlFn = (typeof playData.url === 'function') ? playData.url : ((typeof playData.file === 'function') ? playData.file : null);
        if (urlFn) {
            showToast('Підготовка потоку...');
            var resolved = false;
            var timer = setTimeout(function () {
                if (!resolved) {
                    resolved = true;
                    callback(playData);
                }
            }, 8000);

            try {
                urlFn(function (res) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        var u = extractUrlFromItem(res) || extractUrlFromItem(playData);
                        if (u) playData._directUrl = u;
                        callback(playData);
                    }
                });
            } catch (e) {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    callback(playData);
                }
            }
            return;
        }

        callback(playData);
    }

    // --- ЗМІНА ТРЕКУ В ПЛЕЙЛІСТІ (ВІДТВОРЕННЯ НАСТУПНОЇ/ПОПЕРЕДНЬОЇ СЕРІЇ) ---
    function handleTrackChange(newIndex) {
        if (typeof newIndex !== 'number' || newIndex < 0 || newIndex >= activePlaylistEpisodes.length || newIndex === currentTrackIndex) return;

        // 1. Зберігаємо фінальний таймкод попередньої серії
        if (currentTrackIndex >= 0 && activePlaylistEpisodes[currentTrackIndex] && lastReportedTime > 5) {
            updateEpisodeTimeline(currentTrackIndex, lastReportedTime, lastReportedDuration);
        }

        // 2. Оновлюємо поточний індекс серії
        currentTrackIndex = newIndex;
        lastReportedTime = -1;
        lastReportedDuration = -1;

        var activeEp = activePlaylistEpisodes[currentTrackIndex];
        if (activeEp) {
            showToast('MPV: ' + (activeEp.shortTitle || activeEp.title));

            var epTimeline = resolveEpisodeTimeline(activeEp, activeEp.season, activeEp.episode, (typeof activeEp.season !== 'undefined'), activeMediaCard, null);
            var initDur = (epTimeline && epTimeline.duration > 0) ? epTimeline.duration : 0;
            var initTime = (epTimeline && epTimeline.time > 0) ? epTimeline.time : 0;
            updateEpisodeTimeline(currentTrackIndex, initTime, initDur);

            if (mpvSocket && !mpvSocket.destroyed) {
                mpvSocket.write(JSON.stringify({ command: ['set_property', 'start', 'none'] }) + '\n');
                if (initTime > 5) {
                    mpvSocket.write(JSON.stringify({ command: ['seek', Math.floor(initTime), 'absolute'] }) + '\n');
                }
            }
        }
    }

    // --- MPV IPC КЛІЄНТ ТА СИНХРОНІЗАЦІЯ (ЯКЩО ДОСТУПНИЙ NET МОДУЛЬ) ---
    function connectMpvIPC(pipeName) {
        if (!node_net || typeof node_net.connect !== 'function') return;

        if (mpvSocket) {
            try { mpvSocket.destroy(); } catch (e) {}
            mpvSocket = null;
        }

        var s = node_net.connect(pipeName);
        var ipcBuffer = '';

        s.on('connect', function () {
            mpvSocket = s;
            mpvConnectRetries = 0;
            isPlaying = true;
            showToast('MPV: Підключено (Плейліст: ' + activePlaylistEpisodes.length + ' сер.)');

            s.write(JSON.stringify({ command: ['observe_property', 1, 'playlist-pos'] }) + '\n');
            s.write(JSON.stringify({ command: ['observe_property', 2, 'time-pos'] }) + '\n');
            s.write(JSON.stringify({ command: ['observe_property', 3, 'duration'] }) + '\n');

            var initialEp = activePlaylistEpisodes[currentTrackIndex];
            var initTime = (initialEp && initialEp._initialTime > 5) ? initialEp._initialTime : ((initialEp && initialEp.timeline && initialEp.timeline.time > 5) ? initialEp.timeline.time : 0);
            if (initTime > 5) {
                s.write(JSON.stringify({ command: ['seek', Math.floor(initTime), 'absolute'] }) + '\n');
            }

            if (pollingInterval) clearInterval(pollingInterval);
            pollingInterval = setInterval(function () {
                if (mpvSocket && !mpvSocket.destroyed) {
                    mpvSocket.write(JSON.stringify({ command: ['get_property', 'playlist-pos'], request_id: 101 }) + '\n');
                    mpvSocket.write(JSON.stringify({ command: ['get_property', 'time-pos'], request_id: 102 }) + '\n');
                    mpvSocket.write(JSON.stringify({ command: ['get_property', 'duration'], request_id: 103 }) + '\n');
                }
            }, 1000);
        });

        s.on('data', function (buf) {
            ipcBuffer += decodeChunk(buf);
            var lines = ipcBuffer.split('\n');
            ipcBuffer = lines.pop();

            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (!line) continue;
                try {
                    var msg = JSON.parse(line);

                    if ((msg.event === 'property-change' && msg.name === 'playlist-pos') || (msg.request_id === 101 && typeof msg.data === 'number')) {
                        var newIdx = (typeof msg.data === 'number') ? msg.data : (msg.event === 'property-change' ? msg.data : null);
                        if (typeof newIdx === 'number' && newIdx >= 0 && newIdx !== currentTrackIndex) {
                            handleTrackChange(newIdx);
                        }
                    }

                    if ((msg.event === 'property-change' && msg.name === 'time-pos' && typeof msg.data === 'number') || (msg.request_id === 102 && typeof msg.data === 'number')) {
                        var curTime = msg.data;
                        if (curTime >= 0) {
                            lastReportedTime = curTime;
                            var curDur = (lastReportedDuration > 0) ? lastReportedDuration : ((activePlaylistEpisodes[currentTrackIndex] && activePlaylistEpisodes[currentTrackIndex].timeline) ? activePlaylistEpisodes[currentTrackIndex].timeline.duration : 0);
                            updateEpisodeTimeline(currentTrackIndex, curTime, curDur);
                        }
                    }

                    if ((msg.event === 'property-change' && msg.name === 'duration' && typeof msg.data === 'number') || (msg.request_id === 103 && typeof msg.data === 'number')) {
                        var totalDur = msg.data;
                        if (totalDur > 0) {
                            lastReportedDuration = totalDur;
                            var curTimeVal = (lastReportedTime >= 0) ? lastReportedTime : ((activePlaylistEpisodes[currentTrackIndex] && activePlaylistEpisodes[currentTrackIndex].timeline) ? activePlaylistEpisodes[currentTrackIndex].timeline.time : 0);
                            updateEpisodeTimeline(currentTrackIndex, curTimeVal, totalDur);
                        }
                    }

                    if (msg.event === 'shutdown') {
                        showToast('MPV: Плеєр закрито');
                        stopPolling();
                    }
                } catch (e) {}
            }
        });

        s.on('error', function () {
            mpvConnectRetries++;
            if (mpvConnectRetries < 50 && isPlaying) {
                mpvConnectTimeout = setTimeout(function () {
                    connectMpvIPC(pipeName);
                }, 250);
            }
        });

        s.on('close', function () {
            if (isPlaying) {
                showToast('MPV: Відключено');
                stopPolling();
            }
        });
    }

    // --- ЗАПУСК ПРОЦЕСУ З ПЕРЕБОРОМ ШЛЯХІВ ---
    function trySpawnPlayer(candidates, args, spawnOpts, onSpawnSuccess, onAllFailed) {
        if (!node_cp || typeof node_cp.spawn !== 'function') {
            if (onAllFailed) onAllFailed('Модуль child_process недоступний');
            return;
        }

        var index = 0;
        function tryNext() {
            if (index >= candidates.length) {
                if (onAllFailed) onAllFailed('MPV не знайдено за стандартними шляхами');
                return;
            }
            var currentExe = candidates[index++];
            if (!currentExe) {
                tryNext();
                return;
            }

            try {
                var opts = Object.assign({ detached: true, stdio: ['ignore', 'pipe', 'pipe'] }, spawnOpts || {});
                var child = node_cp.spawn(currentExe, args, opts);
                var hasFailed = false;

                if (child && typeof child.on === 'function') {
                    child.on('error', function () {
                        hasFailed = true;
                        tryNext();
                    });
                }

                setTimeout(function () {
                    if (!hasFailed) {
                        if (onSpawnSuccess) onSpawnSuccess(child, currentExe);
                    }
                }, 300);
            } catch (err) {
                tryNext();
            }
        }

        tryNext();
    }

    // --- ГОЛОВНА ФУНКЦІЯ ЗАПУСКУ MPV ---
    function launchPlayer(playData) {
        stopPolling();
        isPlaying = true;

        resolveInitialPlayData(playData, function (resolvedData) {
            showToast('Формування плейліста...');

            buildPlaylistDataAsync(resolvedData, function (playlistInfo) {
                activePlaylistEpisodes = playlistInfo.episodes;
                currentTrackIndex = playlistInfo.startTrackIndex || 0;
                var m3uContent = playlistInfo.m3uContent || '';

                var startSec = playlistInfo.firstStartTime || 0;
                if (resolvedData.timeline && resolvedData.timeline.time > 5 && startSec <= 5) {
                    startSec = resolvedData.timeline.time;
                }

                // Оновлюємо початковий стан в Lampa
                if (activePlaylistEpisodes[currentTrackIndex]) {
                    var initDur = (activePlaylistEpisodes[currentTrackIndex].timeline && activePlaylistEpisodes[currentTrackIndex].timeline.duration) || 0;
                    updateEpisodeTimeline(currentTrackIndex, startSec, initDur);
                }

            var candidates = getMpvCandidates();
            var currentMpvPipe = '\\\\.\\pipe\\lampa_mpv_' + Date.now();

            var args = [
                '--playlist=env://LAMPA_PLAYLIST',
                '--playlist-start=' + currentTrackIndex,
                '--force-window=yes',
                '--term-status-msg=LAMPA_TIME:${=time-pos:0}|${=duration:0}|${playlist-pos:0}|\\n',
                '--msg-level=all=status,cplayer=info',
                '--terminal=yes',
                '--title=${media-title}',
                '--keep-open=yes',
                '--idle=yes'
            ];

            if (startSec > 5) {
                args.push('--input-commands=seek ' + Math.floor(startSec) + ' absolute');
            }
            if (node_net) {
                args.push('--input-ipc-server=' + currentMpvPipe);
            }

            var mergedEnv = Object.assign({}, (typeof process !== 'undefined' && process.env) ? process.env : {}, {
                LAMPA_PLAYLIST: m3uContent
            });

            var spawnOpts = {
                env: mergedEnv
            };

            showToast('Запуск MPV...');

            trySpawnPlayer(candidates, args, spawnOpts, function (child, usedExe) {
                showToast('MPV: Відкрито! (Серій: ' + activePlaylistEpisodes.length + ')');

                // 1. Двосторонній моніторинг stdout MPV для таймкодів
                if (child && child.stdout && typeof child.stdout.on === 'function') {
                    var stdoutBuf = '';
                    child.stdout.on('data', function (chunk) {
                        var text = decodeChunk(chunk);
                        stdoutBuf += text;
                        var lines = stdoutBuf.split(/[\r\n]+/);
                        stdoutBuf = lines.pop() || '';

                        for (var i = 0; i < lines.length; i++) {
                            var line = lines[i];

                            // 1.1 Перевірка форматованого рядка LAMPA_TIME
                            var match = line.match(/LAMPA_TIME:([0-9.]+)\|([0-9.]+)\|([0-9]+)\|/);
                            if (match) {
                                var curT = parseFloat(match[1]);
                                var curD = parseFloat(match[2]);
                                var curP = parseInt(match[3], 10);

                                if (!isNaN(curP) && curP >= 0 && curP < activePlaylistEpisodes.length && curP !== currentTrackIndex) {
                                    handleTrackChange(curP);
                                }
                                if (!isNaN(curT) && curT >= 0) {
                                    lastReportedTime = curT;
                                    if (curD > 0) lastReportedDuration = curD;
                                    updateEpisodeTimeline(currentTrackIndex, curT, (curD > 0 ? curD : lastReportedDuration));
                                }
                                continue;
                            }

                            // 1.2 Перевірка стандартного статусу MPV: "AV: 00:01:23 / 01:45:00"
                            var avMatch = line.match(/(?:AV|V|A)?:\s*(\d{1,2}):(\d{2}):(\d{2})\s*\/\s*(\d{1,2}):(\d{2}):(\d{2})/);
                            if (avMatch) {
                                var curSec = parseInt(avMatch[1], 10) * 3600 + parseInt(avMatch[2], 10) * 60 + parseInt(avMatch[3], 10);
                                var totalSec = parseInt(avMatch[4], 10) * 3600 + parseInt(avMatch[5], 10) * 60 + parseInt(avMatch[6], 10);
                                if (!isNaN(curSec) && curSec >= 0) {
                                    lastReportedTime = curSec;
                                    if (totalSec > 0) lastReportedDuration = totalSec;
                                    updateEpisodeTimeline(currentTrackIndex, curSec, (totalSec > 0 ? totalSec : lastReportedDuration));
                                }
                                continue;
                            }
                        }
                    });
                }

                // 2. Обробка закриття процесу MPV
                if (child && typeof child.on === 'function') {
                    child.on('exit', function () {
                        showToast('MPV: Плеєр закрито');
                        stopPolling();
                    });
                }

                // 3. Підключення через IPC сокет якщо доступний
                if (node_net && currentMpvPipe) {
                    mpvConnectRetries = 0;
                    mpvConnectTimeout = setTimeout(function () {
                        connectMpvIPC(currentMpvPipe);
                    }, 600);
                }

            }, function (errMsg) {
                showToast('Помилка: ' + errMsg);
                stopPolling();
            });
        });
        });
    }

    // --- ПЕРЕХОПЛЕННЯ LAMPA.PLAYER ---
    function initExternalPlayer() {
        if (window.__pc_players_inited) return;
        window.__pc_players_inited = true;

        var originalPlay = Lampa.Player.play;
        var originalPlaylist = Lampa.Player.playlist;

        Lampa.Player.playlist = function (list) {
            if (typeof originalPlaylist === 'function') {
                try { originalPlaylist.call(Lampa.Player, list); } catch (e) {}
            }
        };

        Lampa.Player.play = function (data) {
            stopPolling();

            if (!data) {
                if (typeof originalPlay === 'function') originalPlay.call(Lampa.Player, data);
                return;
            }

            var videoUrl = data.url || data.file || '';
            var isYoutube = data.youtube === true || (typeof videoUrl === 'string' && (videoUrl.indexOf('youtube.com') > -1 || videoUrl.indexOf('youtu.be') > -1));
            var isVinyl = data.vinyl === true || window.__vinyl_active === true;
            var isIPTV = data.iptv === true || data.is_iptv === true || data.type === 'iptv' || data.type === 'live' || data.is_live === true || (data.channel !== undefined);

            if (isYoutube || isVinyl || isIPTV || (!videoUrl && typeof data.url !== 'function')) {
                if (typeof originalPlay === 'function') {
                    originalPlay.call(Lampa.Player, data);
                }
                return;
            }

            var items = [
                { title: 'MPV', player: 'mpv' },
                { title: 'Вбудований (Lampa)', player: 'lampa' }
            ];

            Lampa.Select.show({
                title: 'Відкрити відео у...',
                items: items,
                onSelect: function (item) {
                    if (item.player === 'lampa') {
                        setTimeout(function () {
                            if (typeof originalPlay === 'function') originalPlay.call(Lampa.Player, data);
                        }, 50);
                    } else {
                        launchPlayer(data);
                    }
                },
                onBack: function () {
                    Lampa.Controller.toggle('content');
                }
            });
        };
    }

    if (window.appready) initExternalPlayer();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') initExternalPlayer(); });

})();