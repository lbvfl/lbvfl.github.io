(function() {
    'use strict';

    window.lampac_firebase_reloading = false;
    window.lampac_firebase_initial_pull_done = false;

    // === НАЛАШТУВАННЯ АВТОРИЗАЦІЇ FIREBASE ===
    var FB_AUTH = {
    apiKey: 'AIzaSyDZUbeNzOJI7kS-heVDvtnIJPbhDtphy8c',
    email: '',
    password: '',
    dbUrl: 'https://my-firebase-20665-default-rtdb.europe-west1.firebasedatabase.app/'
   };


// === ВВЕДЕННЯ EMAIL І ПАРОЛЯ FIREBASE ЧЕРЕЗ LAMPA ===

function loadFirebaseCredentials() {
    FB_AUTH.email = Lampa.Storage.get('fb_auth_email', '') || '';
    FB_AUTH.password = Lampa.Storage.get('fb_auth_password', '') || '';
}

function editFirebaseCredentials() {
    loadFirebaseCredentials();

    Lampa.Input.edit({
        title: 'Email Firebase',
        value: FB_AUTH.email,
        free: true,
        nosave: true
    }, function(email) {

        if (!email) return;

        Lampa.Input.edit({
            title: 'Пароль Firebase',
            value: '',
            free: true,
            nosave: true
        }, function(password) {

            if (!password) return;

            FB_AUTH.email = email.trim();
            FB_AUTH.password = password;

            Lampa.Storage.set(
                'fb_auth_email',
                FB_AUTH.email,
                true
            );

            Lampa.Storage.set(
                'fb_auth_password',
                FB_AUTH.password,
                true
            );

            // Скидаємо старий токен
            fb_idToken = null;
            fb_tokenExpire = 0;

            Lampa.Storage.set('fb_id_token', null, true);
            Lampa.Storage.set('fb_token_expire', 0, true);

            Lampa.Noty.show('Дані Firebase збережено');
        });
    });
}



    var sync_keys = [
        'favorite', 'online_view', 'online_last_balanser', 
        'online_watched_last', 'torrents_view', 'torrents_filter_data'
    ];

    // === СИСТЕМА АВТОРИЗАЦІЇ ТА ЗАПИТІВ ===
    var fb_idToken = null;
    var fb_tokenExpire = 0;
    var fb_auth_pending = false;
    var fb_auth_queue = [];

    function safeClone(obj) {
        if (!obj) return {};
        try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return {}; }
    }

    function canonicalJson(obj) {
        if (obj === null || typeof obj !== 'object') {
            return JSON.stringify(obj);
        }
        if (Array.isArray(obj)) {
            return '[' + obj.map(canonicalJson).join(',') + ']';
        }
        var keys = Object.keys(obj).sort();
        return '{' + keys.map(function(k) {
            return JSON.stringify(k) + ':' + canonicalJson(obj[k]);
        }).join(',') + '}';
    }

    function isDataDifferent(data1, data2) {
        if (data1 === data2) return false;
        if (!data1 && !data2) return false;
        if (!data1 || !data2) return true;
        try {
            var o1 = typeof data1 === 'string' ? JSON.parse(data1) : data1;
            var o2 = typeof data2 === 'string' ? JSON.parse(data2) : data2;
            return canonicalJson(o1) !== canonicalJson(o2);
        } catch(e) {
            return String(data1) !== String(data2);
        }
    }

    // Нормалізація таймкоду під усі платформи (Android Just+, Windows MPV, VLC, TorrServer тощо)
    function normalizeTimecodeItem(item) {
        if (typeof item === 'number') {
            item = { percent: item, time: 0, duration: 0 };
        }
        if (!item || typeof item !== 'object') return null;

        var time = parseFloat(item.time) || 0;
        var duration = parseFloat(item.duration) || 0;
        var percent = parseFloat(item.percent);
        if (isNaN(percent)) percent = 0;

        // Конвертація з мілісекунд у секунди, якщо значення перевищують 24 години (> 86400)
        if (duration > 86400) {
            duration = Math.round(duration / 1000);
            if (time > 86400) time = Math.round(time / 1000);
        } else if (time > 86400) {
            time = Math.round(time / 1000);
        }

        // Автопідрахунок відсотка, якщо тривалість відома
        if (duration > 0 && percent <= 0 && time > 0) {
            percent = Math.min(100, Math.round((time / duration) * 100));
        }

        percent = Math.max(0, Math.min(100, percent));

        // Статус завершення (Just+ і нові версії Lampa маркують завершені як percent = 100, time = 0, duration = 0)
        var ended = percent >= 100 || (duration > 0 && time >= duration * 0.96);
        if (ended) {
            percent = 100;
        }

        var ts = Math.max(parseInt(item._timestamp) || 0, parseInt(item.updated) || 0);

        return {
            time: time,
            duration: duration,
            percent: percent,
            profile: item.profile || 0,
            _timestamp: ts,
            updated: ts
        };
    }

    function isTimecodeDifferent(lItem, rItem) {
        if (!lItem && !rItem) return false;
        if (!lItem || !rItem) return true;

        var lNorm = normalizeTimecodeItem(lItem);
        var rNorm = normalizeTimecodeItem(rItem);
        if (!lNorm && !rNorm) return false;
        if (!lNorm || !rNorm) return true;

        // Якщо обидва завершені (100%), вони представляють один і той самий стан перегляду
        if (lNorm.percent >= 100 && rNorm.percent >= 100) {
            return false;
        }

        // Один завершений, інший ні — очевидна різниця
        if ((lNorm.percent >= 100) !== (rNorm.percent >= 100)) {
            return true;
        }

        var lTime = Math.round(lNorm.time);
        var rTime = Math.round(rNorm.time);
        var lPct = Math.round(lNorm.percent);
        var rPct = Math.round(rNorm.percent);
        var lDur = Math.round(lNorm.duration);
        var rDur = Math.round(rNorm.duration);

        // Якщо позиція відрізняється більше ніж на 2 сек або відсоток більше ніж на 1%
        if (Math.abs(lTime - rTime) > 2 || Math.abs(lPct - rPct) > 1) {
            return true;
        }

        // Якщо тривалість суттєво відрізняється (> 5 сек)
        if (lDur !== rDur && lDur > 0 && rDur > 0 && Math.abs(lDur - rDur) > 5) {
            return true;
        }

        return false;
    }

    function mergeTimecode(localItem, remoteItem) {
        if (!localItem) return remoteItem;
        if (!remoteItem) return localItem;

        var lNorm = normalizeTimecodeItem(localItem);
        var rNorm = normalizeTimecodeItem(remoteItem);
        if (!lNorm) return remoteItem;
        if (!rNorm) return localItem;

        var lTs = Math.max(lNorm._timestamp, lNorm.updated, 0);
        var rTs = Math.max(rNorm._timestamp, rNorm.updated, 0);

        if (rTs > lTs) {
            // Хмара новіша: беремо її дані, але якщо в хмарі duration = 0 (Just+ при ended), а локально duration відома — зберігаємо duration
            if (rNorm.duration === 0 && lNorm.duration > 0) {
                rNorm.duration = lNorm.duration;
            }
            return rNorm;
        } else if (lTs > rTs) {
            if (lNorm.duration === 0 && rNorm.duration > 0) {
                lNorm.duration = rNorm.duration;
            }
            return lNorm;
        } else {
            if (rNorm.percent > lNorm.percent) return rNorm;
            if (lNorm.duration === 0 && rNorm.duration > 0) lNorm.duration = rNorm.duration;
            return lNorm;
        }
    }

    function refreshLampaUI() {
        if (!window.Lampa) return;
        try {
            if (Lampa.Favorite && typeof Lampa.Favorite.read === 'function') {
                Lampa.Favorite.read();
            }
            if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                Lampa.Timeline.read(false);
            }
            Lampa.Listener.send('state:changed', { target: 'favorite', reason: 'read' });
            Lampa.Listener.send('state:changed', { target: 'timeline', reason: 'read' });
        } catch(e) {}
    }

    function getAuthToken(callback, errorCallback) {

    // Завантажуємо Email і пароль із налаштувань Lampa
    loadFirebaseCredentials();

    if (!FB_AUTH.email || !FB_AUTH.password) {
        Lampa.Noty.show(
            'Вкажіть Email і пароль Firebase у налаштуваннях'
        );

        if (errorCallback) errorCallback();

        return;
    }

    if (!fb_idToken && window.Lampa && Lampa.Storage) {
            try {
                fb_idToken = Lampa.Storage.get('fb_id_token', null);
                fb_tokenExpire = parseInt(Lampa.Storage.get('fb_token_expire', 0)) || 0;
            } catch(e) {}
        }
        if (fb_idToken && Date.now() < fb_tokenExpire) {
            return callback(fb_idToken);
        }
        
        fb_auth_queue.push({ onSuccess: callback, onError: errorCallback });
        if (fb_auth_pending) return;
        
        fb_auth_pending = true;
        
        $.ajax({
            url: 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + FB_AUTH.apiKey,
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ email: FB_AUTH.email, password: FB_AUTH.password, returnSecureToken: true }),
            timeout: 15000,
            success: function(res) {
                if (res && res.idToken) {
                    fb_idToken = res.idToken;
                    fb_tokenExpire = Date.now() + (res.expiresIn * 1000) - 60000;
                    if (window.Lampa && Lampa.Storage) {
                        try {
                            Lampa.Storage.set('fb_id_token', fb_idToken, true);
                            Lampa.Storage.set('fb_token_expire', fb_tokenExpire, true);
                        } catch(e) {}
                    }
                    fb_auth_pending = false;
                    while (fb_auth_queue.length > 0) { fb_auth_queue.shift().onSuccess(fb_idToken); }
                }
            },
            error: function() {
                fb_auth_pending = false;
                while (fb_auth_queue.length > 0) { 
                    var q = fb_auth_queue.shift();
                    if (q.onError) q.onError();
                }
                Lampa.Noty.show('Помилка авторизації Firebase');
            }
        });
    }

    function fbRequest(method, path, dataObj, onSuccess, onError, options) {
        getAuthToken(function(token) {
            var cacheBuster = method === 'GET' ? '&_t=' + Date.now() : '';
            var url = FB_AUTH.dbUrl + path + '.json?auth=' + token + cacheBuster;
            var jsonBody = (dataObj !== null && dataObj !== undefined) ? JSON.stringify(dataObj) : null;
            
            var useKeepalive = (options && options.keepalive) || (typeof document !== 'undefined' && document.visibilityState === 'hidden');

            if (useKeepalive && typeof window.fetch === 'function' && method !== 'GET') {
                try {
                    window.fetch(url, {
                        method: method,
                        headers: { 'Content-Type': 'application/json; charset=utf-8' },
                        body: jsonBody,
                        keepalive: true
                    }).then(function(res) {
                        if (res.ok) {
                            return res.json().then(function(data) {
                                if (onSuccess) onSuccess(data);
                            }).catch(function() {
                                if (onSuccess) onSuccess(null);
                            });
                        } else {
                            if (onError) onError(new Error('HTTP ' + res.status));
                        }
                    }).catch(function(err) {
                        if (onError) onError(err);
                    });
                    return;
                } catch(e) {
                    // Fallback to $.ajax
                }
            }

            var reqOpts = {
                url: url,
                type: method,
                contentType: 'application/json; charset=utf-8', 
                timeout: 30000, 
                success: onSuccess,
                error: function(err) {
                    console.log("Firebase Request Error:", err);
                    if (onError) onError(err);
                }
            };
            
            if (jsonBody !== null) {
                reqOpts.data = jsonBody;
            }
            $.ajax(reqOpts);
        }, function(err) { if (onError) onError(err); });
    }

    function reloadApp(message) {
        if (window.lampac_firebase_reloading) return;
        window.lampac_firebase_reloading = true;
        try { if (typeof Lampa.Storage.save === 'function') Lampa.Storage.save(); } catch(e) {}
        Lampa.Noty.show(message + ' (3 сек)');
        setTimeout(function() { window.location.reload(); }, 3000);
    }

    function downloadLocalFile(dataObj, filename) {
        try {
            var blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(function() { URL.revokeObjectURL(url); }, 100);
            Lampa.Noty.show('Файл успішно збережено');
        } catch (e) { Lampa.Noty.show('Помилка експорту на цьому пристрої'); }
    }

    function uploadLocalFile(callback) {
        try {
            var input = document.createElement('input');
            input.type = 'file'; input.accept = '.json';
            input.onchange = function(e) {
                var file = e.target.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onload = function(evt) {
                    try { callback(JSON.parse(evt.target.result)); } 
                    catch (err) { Lampa.Noty.show('Помилка формату файлу!'); }
                };
                reader.readAsText(file);
            };
            input.click();
        } catch(e) { Lampa.Noty.show('Пристрій не підтримує завантаження файлів'); }
    }

    function updateMenuStatus(id, text) {
        if ($('#' + id).length) $('#' + id).text(text);
    }

    function confirmAction(callback) {
        setTimeout(function() {
            Lampa.Select.show({
                title: Lampa.Lang.translate('sure') || 'Ви впевнені?', nomark: true,
                items:[ { title: 'Так', action: true, selected: true }, { title: 'Скасувати' } ],
                onSelect: function(a) { 
                    if (a.action) callback();
                    setTimeout(function() { Lampa.Controller.toggle('settings_component'); }, 10);
                },
                onBack: function() { Lampa.Controller.toggle('settings_component'); }
            });
        }, 50);
    }

    // ==========================================
    // 1. ПЛАГІНИ, ІСТОРІЯ, ТАЙМКОДИ 
    // ==========================================
    var PluginsSync = {
        goPush: function(manual) {
            if (manual) Lampa.Noty.show('Відправка плагінів...');
            try {
                var pluginsData = localStorage.getItem('plugins');
                if (!pluginsData || typeof pluginsData !== 'string' || pluginsData.trim() === '') pluginsData = '[]';
                var now = Date.now();
                Lampa.Storage.set('fb_plugins_ts', now, true);

                fbRequest('PUT', 'plugins_sync', { data: pluginsData, _timestamp: now }, 
                    function() {
                        if (manual) Lampa.Noty.show('Плагіни збережено у хмару');
                        var text = new Date().toLocaleString('uk-UA') + ' (Відправка)';
                        Lampa.Storage.set('fb_plugins_last_time', text); updateMenuStatus('fb_status_plugins', text);
                    }, function() { if (manual) Lampa.Noty.show('Помилка відправки плагінів'); }
                );
            } catch (e) { if (manual) Lampa.Noty.show('Script Error під час відправки плагінів'); }
        },
        goPull: function(manual) { 
            if (manual) Lampa.Noty.show('Отримання плагінів...');
            fbRequest('GET', 'plugins_sync', null, function(json) {
                try {
                    if (json && json.data) {
                        var cloudDataStr = typeof json.data === 'string' ? json.data : JSON.stringify(json.data);
                        var cloudTs = parseInt(json._timestamp) || 0;
                        var localTs = parseInt(Lampa.Storage.get('fb_plugins_ts', 0)) || 0;
                        var localData = localStorage.getItem('plugins') || '[]';
                        var isDiff = isDataDifferent(cloudDataStr, localData);
                        
                        if (manual || (cloudTs > localTs && isDiff)) {
                            try { localStorage.setItem('plugins', cloudDataStr); } catch(e) {} 
                            Lampa.Storage.set('fb_plugins_ts', Math.max(localTs, cloudTs), true);
                            var text = new Date().toLocaleString('uk-UA') + ' (Отримання)';
                            Lampa.Storage.set('fb_plugins_last_time', text); updateMenuStatus('fb_status_plugins', text);
                            reloadApp(manual ? 'Плагіни відновлено' : '🔄 Синхронізація плагінів');
                        } else {
                            if (!isDiff && cloudTs > localTs) {
                                Lampa.Storage.set('fb_plugins_ts', cloudTs, true);
                            }
                            if (manual) Lampa.Noty.show('У вас найновіші плагіни');
                        }
                    } else if (manual) Lampa.Noty.show('Хмара порожня');
                } catch(e) { Lampa.Noty.show('Помилка обробки плагінів'); }
            });
        },
        fileExport: function() { 
            var pData = localStorage.getItem('plugins');
            if (!pData || typeof pData !== 'string' || pData.trim() === '') pData = '[]';
            downloadLocalFile(JSON.parse(pData), 'lampa_plugins.json'); 
        },
        fileImport: function() {
            uploadLocalFile(function(data) {
                try { localStorage.setItem('plugins', JSON.stringify(data)); } catch(e) {}
                Lampa.Storage.set('fb_plugins_ts', Date.now(), true); reloadApp('Файл плагінів завантажено');
            });
        }
    };

    var DataSync = {
        pushTimers: {},
        isSyncingNow: false,
        syncedCache: {},
        outbox: {},
        isPushing: false,
        retryTimer: null,
        retryCount: 0,

        get memoryCache() { return this.syncedCache; },
        set memoryCache(val) { this.syncedCache = val || {}; },

        initOutbox: function() {
            try {
                var saved = Lampa.Storage.get('fb_sync_outbox', {});
                if (saved && typeof saved === 'object') {
                    this.outbox = saved;
                }
            } catch(e) { this.outbox = {}; }
        },

        saveOutbox: function() {
            try {
                Lampa.Storage.set('fb_sync_outbox', this.outbox, true);
            } catch(e) {}
        },

        getLocalTs: function() { return safeClone(Lampa.Storage.get('fb_sync_timestamps', {})); },
        saveLocalTs: function(ts) { Lampa.Storage.set('fb_sync_timestamps', ts, true); },

        enqueue: function(key) {
            var localData = Lampa.Storage.get(key);
            if (localData === undefined || localData === null) return;
            var str = JSON.stringify(localData);
            if (this.syncedCache[key] === str) return;

            var now = Date.now();
            var ts = this.getLocalTs();
            var currentTs = parseInt(ts[key]) || 0;
            var newTs = Math.max(now, currentTs + 1);
            ts[key] = newTs;
            this.saveLocalTs(ts);

            this.outbox[key] = { data: localData, _timestamp: newTs };
            this.saveOutbox();
        },

        scanLocalChanges: function(forceAll) {
            var self = this;
            var now = Date.now();
            var ts = this.getLocalTs();
            var tsChanged = false;
            sync_keys.forEach(function(key) {
                var localData = Lampa.Storage.get(key);
                if (localData !== undefined && localData !== null) {
                    var str = JSON.stringify(localData);
                    if (self.syncedCache[key] !== str || forceAll) {
                        var currentTs = parseInt(ts[key]) || 0;
                        var newTs = Math.max(now, currentTs + 1);
                        ts[key] = newTs;
                        tsChanged = true;
                        self.outbox[key] = { data: localData, _timestamp: newTs };
                    }
                }
            });
            if (tsChanged) this.saveLocalTs(ts);
            this.saveOutbox();
        },

        getPushData: function(forceAll) {
            this.scanLocalChanges(forceAll);
            var keys = Object.keys(this.outbox);
            return keys.length > 0 ? safeClone(this.outbox) : null;
        },

        pushPending: function(isImmediate, onDone) {
            var self = this;
            if (!window.lampac_firebase_initial_pull_done || window.lampac_firebase_reloading) {
                if (onDone) onDone(false);
                return;
            }

            var keys = Object.keys(self.outbox);
            if (keys.length === 0) {
                if (onDone) onDone(true);
                return;
            }

            if (self.isPushing) {
                if (onDone) onDone(false);
                return;
            }

            self.isPushing = true;
            clearTimeout(self.retryTimer);

            var batch = {};
            keys.forEach(function(k) { batch[k] = self.outbox[k]; });

            fbRequest('PATCH', 'global_sync', batch, function() {
                self.isPushing = false;
                self.retryCount = 0;

                for (var k in batch) {
                    self.syncedCache[k] = JSON.stringify(batch[k].data);
                    if (self.outbox[k] && self.outbox[k]._timestamp <= batch[k]._timestamp) {
                        delete self.outbox[k];
                    }
                }
                self.saveOutbox();

                var text = new Date().toLocaleString('uk-UA') + (isImmediate ? ' (Миттєво)' : ' (Авто)');
                Lampa.Storage.set('fb_sync_last_time', text, true);
                updateMenuStatus('fb_status_sync', text);

                if (Object.keys(self.outbox).length > 0) {
                    setTimeout(function() { self.pushPending(false); }, 100);
                }
                if (onDone) onDone(true);
            }, function(err) {
                self.isPushing = false;
                self.retryCount++;
                var delay = Math.min(30000, 2000 * Math.pow(1.5, Math.min(self.retryCount, 6)));
                self.retryTimer = setTimeout(function() {
                    self.pushPending(false);
                }, delay);

                if (onDone) onDone(false, err);
            }, { keepalive: isImmediate });
        },

        pushSingle: function(key) {
            this.enqueue(key);
            this.pushPending(false);
        },

        goPush: function(manual) {
            var self = this;
            if (manual) Lampa.Noty.show('Відправка історії та обраного...');
            this.scanLocalChanges(true);
            var keys = Object.keys(this.outbox);
            if (keys.length === 0) {
                if (manual) Lampa.Noty.show('Немає даних для відправки');
                return;
            }
            this.pushPending(false, function(success) {
                if (manual) {
                    if (success) Lampa.Noty.show('Дані відправлено');
                    else Lampa.Noty.show('Помилка відправки');
                }
            });
        },

        goPull: function(manual) { 
            var self = this;
            if (manual) Lampa.Noty.show('Отримання даних...');
            fbRequest('GET', 'global_sync', null, function(cloud) {
                if (cloud) {
                    var localTs = self.getLocalTs(), hasChanges = false; 
                    self.isSyncingNow = true;
                    
                    for (var key in cloud) {
                        if (sync_keys.indexOf(key) !== -1 && cloud[key] && cloud[key]._timestamp !== undefined) {
                            var cTs = parseInt(cloud[key]._timestamp) || 0, lTs = parseInt(localTs[key]) || 0;
                            var localVal = Lampa.Storage.get(key);
                            var isDiff = isDataDifferent(cloud[key].data, localVal);
                            if ((cTs > lTs || manual) && cloud[key].data && isDiff) { 
                                Lampa.Storage.set(key, cloud[key].data, true); 
                                self.syncedCache[key] = JSON.stringify(cloud[key].data);
                                localTs[key] = cTs; 
                                hasChanges = true; 
                                if (self.outbox[key]) delete self.outbox[key];
                            } else if (cTs > lTs && !isDiff) {
                                localTs[key] = cTs;
                                self.syncedCache[key] = JSON.stringify(localVal);
                                if (self.outbox[key]) delete self.outbox[key];
                            } else if (cTs === lTs) {
                                self.syncedCache[key] = JSON.stringify(localVal);
                            }
                        }
                    }

                    // Звіряємо локальні дані, якщо вони новіші за хмару
                    sync_keys.forEach(function(key) {
                        var localVal = Lampa.Storage.get(key);
                        if (localVal !== undefined && localVal !== null) {
                            var cItem = cloud[key];
                            var cTs = cItem ? (parseInt(cItem._timestamp) || 0) : 0;
                            var lTs = parseInt(localTs[key]) || 0;
                            var isDiff = !cItem || isDataDifferent(cItem.data, localVal);

                            if (!cItem || (lTs > cTs && isDiff)) {
                                self.enqueue(key);
                            }
                        }
                    });

                    self.saveLocalTs(localTs);
                    self.saveOutbox();

                    if (hasChanges) {
                        var text = new Date().toLocaleString('uk-UA') + ' (Отримання)'; 
                        Lampa.Storage.set('fb_sync_last_time', text, true); 
                        updateMenuStatus('fb_status_sync', text);
                        refreshLampaUI();
                        if (manual) Lampa.Noty.show('Дані успішно завантажено');
                    } else if (manual) {
                        Lampa.Noty.show('У вас найсвіжіші дані');
                    }
                    
                    setTimeout(function() { self.isSyncingNow = false; }, 500);

                    if (Object.keys(self.outbox).length > 0) {
                        self.pushPending(false);
                    }
                } else if (manual) {
                    Lampa.Noty.show('Хмара порожня');
                }
            }, function(err) {
                if (manual) Lampa.Noty.show('Помилка мережі при завантаженні');
            });
        },
        fileExport: function() { var d = {}; sync_keys.forEach(function(k) { d[k] = Lampa.Storage.get(k); }); downloadLocalFile(d, 'lampa_history.json'); },
        fileImport: function() { uploadLocalFile(function(data) {
            var now = Date.now(), localTs = DataSync.getLocalTs();
            DataSync.isSyncingNow = true;
            for (var k in data) { if (sync_keys.indexOf(k) !== -1) { Lampa.Storage.set(k, data[k], true); localTs[k] = now; } }
            DataSync.saveLocalTs(localTs);
            refreshLampaUI();
            setTimeout(function() { DataSync.isSyncingNow = false; }, 500);
            Lampa.Noty.show('Файл Історії/Обраного застосовано');
        }); }
    };

    var TimecodesSync = {
        syncedCache: {},
        outbox: {},
        isPushing: false,
        retryTimer: null,
        retryCount: 0,

        get memoryCache() { return this.syncedCache; },
        set memoryCache(val) { this.syncedCache = val || {}; },

        initOutbox: function() {
            try {
                var saved = Lampa.Storage.get('fb_tc_outbox', {});
                if (saved && typeof saved === 'object') {
                    this.outbox = saved;
                }
            } catch(e) { this.outbox = {}; }
        },

        saveOutbox: function() {
            try {
                Lampa.Storage.set('fb_tc_outbox', this.outbox, true);
            } catch(e) {}
        },

        formatCacheKey: function(item) {
            if (!item) return '';
            return Math.round(item.time || 0) + '_' + Math.round(item.duration || 0) + '_' + Math.round(item.percent || 0);
        },

        getPrimaryStorageKey: function() { 
            return (typeof Lampa.Timeline === 'object' && typeof Lampa.Timeline.filename === 'function') 
                ? Lampa.Timeline.filename() 
                : 'file_view'; 
        },

        getStorageKeys: function() {
            var keys = ['file_view'];
            try {
                if (window.Lampa && Lampa.Timeline && typeof Lampa.Timeline.filename === 'function') {
                    var fn = Lampa.Timeline.filename();
                    if (fn && keys.indexOf(fn) === -1) keys.push(fn);
                }
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf('file_view') === 0 && keys.indexOf(k) === -1) {
                        keys.push(k);
                    }
                }
            } catch(e) {}
            return keys;
        },

        getAll: function() { 
            var merged = {};
            var keys = this.getStorageKeys();
            keys.forEach(function(k) {
                var d = Lampa.Storage.get(k, {});
                if (d && typeof d === 'object') {
                    for (var h in d) {
                        var norm = normalizeTimecodeItem(d[h]);
                        if (norm) {
                            merged[h] = mergeTimecode(merged[h], norm);
                        }
                    }
                }
            });
            return merged;
        },

        saveAll: function(data) { 
            var primaryKey = this.getPrimaryStorageKey();
            Lampa.Storage.set(primaryKey, data, true);
            if (primaryKey !== 'file_view') {
                try { Lampa.Storage.set('file_view', data, true); } catch(e) {}
            }
            if (window.Lampa && Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                try { Lampa.Timeline.read(false); } catch(e) {}
            }
        },

        enqueue: function(hash, item) {
            var norm = normalizeTimecodeItem(item);
            if (!norm) return;
            var cacheKey = this.formatCacheKey(norm);
            if (this.syncedCache[hash] === cacheKey) return;

            var now = Date.now();
            var currentTs = Math.max(parseInt(norm._timestamp) || 0, parseInt(norm.updated) || 0);
            norm._timestamp = Math.max(now, currentTs + 1);
            norm.updated = norm._timestamp;

            this.outbox[hash] = norm;
            this.saveOutbox();
        },

        scanLocalChanges: function(forceAll) {
            var all = this.getAll();
            var hasChanges = false;
            var now = Date.now();
            for (var hash in all) {
                var item = normalizeTimecodeItem(all[hash]);
                if (!item) continue;
                var cacheKey = this.formatCacheKey(item);
                if (this.syncedCache[hash] !== cacheKey || forceAll) {
                    var currentTs = Math.max(parseInt(item._timestamp) || 0, parseInt(item.updated) || 0);
                    if (!item._timestamp || this.syncedCache[hash] !== cacheKey) {
                        item._timestamp = Math.max(now, currentTs + 1);
                        item.updated = item._timestamp;
                        all[hash] = item;
                        hasChanges = true;
                    }
                    this.outbox[hash] = item;
                }
            }
            if (hasChanges) {
                this.saveAll(all);
            }
            this.saveOutbox();
        },

        getPushData: function(forceAll) {
            this.scanLocalChanges(forceAll);
            var keys = Object.keys(this.outbox);
            return keys.length > 0 ? safeClone(this.outbox) : null;
        },

        pushPending: function(isImmediate, onDone) {
            var self = this;
            if (!window.lampac_firebase_initial_pull_done || window.lampac_firebase_reloading) {
                if (onDone) onDone(false);
                return;
            }

            var keys = Object.keys(self.outbox);
            if (keys.length === 0) {
                if (onDone) onDone(true);
                return;
            }

            if (self.isPushing) {
                if (onDone) onDone(false);
                return;
            }

            self.isPushing = true;
            clearTimeout(self.retryTimer);

            var batch = {};
            keys.forEach(function(k) { batch[k] = self.outbox[k]; });

            fbRequest('PATCH', 'global_timecodes', batch, function() {
                self.isPushing = false;
                self.retryCount = 0;

                for (var h in batch) {
                    var item = batch[h];
                    self.syncedCache[h] = self.formatCacheKey(item);
                    if (self.outbox[h] && self.outbox[h]._timestamp <= item._timestamp) {
                        delete self.outbox[h];
                    }
                }
                self.saveOutbox();

                var text = new Date().toLocaleString('uk-UA') + (isImmediate ? ' (Миттєво)' : ' (Авто)');
                Lampa.Storage.set('fb_tc_last_time', text, true);
                updateMenuStatus('fb_status_tc', text);

                if (Object.keys(self.outbox).length > 0) {
                    setTimeout(function() { self.pushPending(false); }, 100);
                }
                if (onDone) onDone(true);
            }, function(err) {
                self.isPushing = false;
                self.retryCount++;
                var delay = Math.min(30000, 2000 * Math.pow(1.5, Math.min(self.retryCount, 6)));
                self.retryTimer = setTimeout(function() {
                    self.pushPending(false);
                }, delay);

                if (onDone) onDone(false, err);
            }, { keepalive: isImmediate });
        },

        autoPush: function() {
            this.scanLocalChanges(false);
            this.pushPending(false);
        },

        goPush: function(manual) {
            var self = this;
            if (manual) Lampa.Noty.show('Відправка таймкодів...');
            this.scanLocalChanges(true);
            var keys = Object.keys(this.outbox);
            if (keys.length === 0) {
                if (manual) Lampa.Noty.show('Немає таймкодів');
                return;
            }
            this.pushPending(false, function(success) {
                if (manual) {
                    if (success) Lampa.Noty.show('Таймкоди відправлено');
                    else Lampa.Noty.show('Помилка відправки таймкодів');
                }
            });
        },

        goPull: function(manual) { 
            var self = this;
            if (manual) Lampa.Noty.show('Отримання таймкодів...');
            fbRequest('GET', 'global_timecodes', null, function(remote) {
                if (remote) {
                    var local = self.getAll(), hasChanges = false, localUpdated = false;

                    // 1. Хмара -> Локально
                    for (var hash in remote) {
                        var rItem = normalizeTimecodeItem(remote[hash]); 
                        if (!rItem) continue;
                        
                        var lItem = local[hash];
                        var rTs = Math.max(rItem._timestamp, rItem.updated, 0);
                        var lTs = lItem ? Math.max(lItem._timestamp, lItem.updated, 0) : 0;
                        var isDiff = !lItem || isTimecodeDifferent(lItem, rItem);
                        
                        if ((rTs > lTs || manual) && isDiff) { 
                            var merged = mergeTimecode(lItem, rItem);
                            local[hash] = merged; 
                            hasChanges = true; 
                            localUpdated = true;
                            self.syncedCache[hash] = self.formatCacheKey(merged);
                            if (self.outbox[hash]) delete self.outbox[hash];
                        } else if (!isDiff) {
                            if (lItem && (!lItem._timestamp || lItem._timestamp < rTs)) {
                                lItem._timestamp = Math.max(lTs, rTs);
                                lItem.updated = lItem._timestamp;
                                localUpdated = true;
                            }
                            var mItem = lItem || rItem;
                            self.syncedCache[hash] = self.formatCacheKey(mItem);
                            if (self.outbox[hash]) delete self.outbox[hash];
                        }
                    }

                    // 2. Локально -> Хмара (звіряємо локальні новіші/офлайн записи)
                    for (var lHash in local) {
                        var curLocal = normalizeTimecodeItem(local[lHash]);
                        if (!curLocal) continue;
                        var curRemote = remote[lHash] ? normalizeTimecodeItem(remote[lHash]) : null;
                        var cTs = curRemote ? Math.max(curRemote._timestamp, curRemote.updated, 0) : 0;
                        var curTs = Math.max(curLocal._timestamp, curLocal.updated, 0);

                        if (!curRemote || (curTs > cTs && isTimecodeDifferent(curLocal, curRemote))) {
                            self.enqueue(lHash, curLocal);
                        }
                    }

                    if (localUpdated) {
                        self.saveAll(local);
                    }
                    self.saveOutbox();

                    if (hasChanges) {
                        var text = new Date().toLocaleString('uk-UA') + ' (Отримання)'; 
                        Lampa.Storage.set('fb_tc_last_time', text, true);
                        updateMenuStatus('fb_status_tc', text);
                        refreshLampaUI();
                        if (manual) Lampa.Noty.show('Таймкоди завантажено');
                    } else if (manual) {
                        Lampa.Noty.show('Таймкоди актуальні');
                    }

                    if (Object.keys(self.outbox).length > 0) {
                        self.pushPending(false);
                    }
                } else if (manual) {
                    Lampa.Noty.show('Хмара порожня');
                }
            }, function(err) {
                if (manual) Lampa.Noty.show('Помилка мережі при завантаженні таймкодів');
            });
        },
        fileExport: function() { downloadLocalFile(this.getAll(), 'lampa_timecodes.json'); },
        fileImport: function() { uploadLocalFile(function(data) {
            var local = TimecodesSync.getAll(), now = Date.now();
            for (var hash in data) { 
                var norm = normalizeTimecodeItem(data[hash]);
                if (norm) { 
                    norm._timestamp = now; 
                    norm.updated = now; 
                    local[hash] = norm; 
                } 
            }
            TimecodesSync.saveAll(local); 
            refreshLampaUI();
            Lampa.Noty.show('Файл таймкодів імпортовано');
        }); }
    };

    // ==========================================
    // ПРОФІЛІ ПОВНОГО БЕКАПУ
    // ==========================================
    function getBackupPath(profileId) {
        if (profileId === 'tv') return 'global_backup_tv';
        if (profileId === 'phone') return 'global_backup_phone';
        return 'global_backup'; 
    }

    var FullBackup = {
        goPush: function(manual, profileId) {
            if (manual) Lampa.Noty.show('Підготовка повного бекапу (' + profileId + ')...');
            var chunks = [];
            var currentChunkData = {};
            var currentChunkSize = 0;
            var MAX_CHUNK_SIZE = 500000;
            var basePath = getBackupPath(profileId);

            try {
                for (var i = 0; i < localStorage.length; i++) {
                    try {
                        var k = localStorage.key(i); 
                        if (k) {
                            var val = localStorage.getItem(k);
                            if (val !== null && typeof val === 'string') {
                                var size = k.length + val.length;
                                if (currentChunkSize + size > MAX_CHUNK_SIZE && Object.keys(currentChunkData).length > 0) {
                                    chunks.push(currentChunkData);
                                    currentChunkData = {};
                                    currentChunkSize = 0;
                                }
                                currentChunkData[k] = val;
                                currentChunkSize += size;
                            }
                        }
                    } catch(errItem) {} 
                }
                if (Object.keys(currentChunkData).length > 0) {
                    chunks.push(currentChunkData);
                }
            } catch(e) {
                if (manual) Lampa.Noty.show('Помилка доступу до сховища');
                return;
            }

            var totalChunks = chunks.length;
            if (totalChunks === 0) {
                if (manual) Lampa.Noty.show('Сховище порожнє, немає що зберігати');
                return;
            }

            var currentChunk = 0;

            function sendNextChunk() {
                if (currentChunk >= totalChunks) {
                    fbRequest('PUT', basePath + '/meta', { total: totalChunks, _timestamp: Date.now() }, function() {
                        if (manual) Lampa.Noty.show('Бекап створено у хмарі (' + totalChunks + ' частин)');
                    });
                    return;
                }
                if (manual) Lampa.Noty.show('Відправка бекапу... (' + (currentChunk + 1) + '/' + totalChunks + ')');
                
                fbRequest('PUT', basePath + '/chunks/' + currentChunk, { data: JSON.stringify(chunks[currentChunk]) }, function() {
                    currentChunk++;
                    setTimeout(sendNextChunk, 100);
                }, function() {
                    if (manual) Lampa.Noty.show('Помилка відправки частини ' + (currentChunk + 1));
                });
            }

            if (manual) Lampa.Noty.show('Очищення старого бекапу...');
            fbRequest('DELETE', basePath, null, function() { sendNextChunk(); }, function() { sendNextChunk(); });
        },
        goPull: function(manual, profileId) {
            if (manual) Lampa.Noty.show('Пошук бекапу в хмарі (' + profileId + ')...');
            var basePath = getBackupPath(profileId);

            fbRequest('GET', basePath + '/meta', null, function(meta) {
                if (meta && meta.total) {
                    var totalChunks = meta.total;
                    var currentChunk = 0;
                    var keysCount = 0;

                    function getNextChunk() {
                        if (currentChunk >= totalChunks) {
                            reloadApp('Бекап відновлено (' + keysCount + ' ключів)');
                            return;
                        }
                        if (manual) Lampa.Noty.show('Отримання бекапу... (' + (currentChunk + 1) + '/' + totalChunks + ')');
                        
                        fbRequest('GET', basePath + '/chunks/' + currentChunk, null, function(chunkRes) {
                            if (chunkRes && chunkRes.data) {
                                try {
                                    var data = typeof chunkRes.data === 'string' ? JSON.parse(chunkRes.data) : chunkRes.data;
                                    for (var i in data) { try { localStorage.setItem(i, data[i]); keysCount++; } catch (err) {} }
                                    currentChunk++;
                                    setTimeout(getNextChunk, 100);
                                } catch (e) {
                                    if (manual) Lampa.Noty.show('Помилка обробки частини ' + (currentChunk + 1));
                                }
                            } else {
                                if (manual) Lampa.Noty.show('Помилка: частина ' + (currentChunk + 1) + ' порожня');
                            }
                        }, function() {
                            if (manual) Lampa.Noty.show('Помилка мережі при завантаженні частини ' + (currentChunk + 1));
                        });
                    }
                    getNextChunk();
                } else {
                    if (manual) Lampa.Noty.show('Завантаження старого формату бекапу...');
                    fbRequest('GET', basePath, null, function(json) {
                        if (json && json.data) {
                            try {
                                var data = typeof json.data === 'string' ? JSON.parse(json.data) : json.data;
                                var keysCount = 0;
                                for (var i in data) { try { localStorage.setItem(i, data[i]); keysCount++; } catch (err) {} }
                                reloadApp('Бекап відновлено (' + keysCount + ' ключів)');
                            } catch (e) { Lampa.Noty.show('Помилка парсингу бекапу'); }
                        } else if (manual) Lampa.Noty.show(Lampa.Lang.translate('nodata') || 'Дані відсутні');
                    });
                }
            }, function() {
                if (manual) Lampa.Noty.show('Помилка доступу до хмари');
            });
        },
        fileExport: function() { try { var b = {}; for (var i = 0; i < localStorage.length; i++) { try { var k = localStorage.key(i); b[k] = localStorage.getItem(k); } catch (e) {} } downloadLocalFile(b, 'lampa_full_backup.json'); } catch(e) {} },
        fileImport: function() { uploadLocalFile(function(data) { var c = 0; for (var i in data) { try { localStorage.setItem(i, data[i]); c++; } catch (err) {} } reloadApp('Локальний бекап відновлено (' + c + ' ключів)'); }); }
    };

    function openBackupMenu() {
        Lampa.Select.show({
            title: 'Повний Бекап (Профілі)',
            items: [
                { title: '⬆️ Відправити в хмару', id: 'push' },
                { title: '⬇️ Отримати з хмари', id: 'pull' },
                { title: '💾 Зберегти у файл', id: 'exp' },
                { title: '📂 Завантажити з файлу', id: 'imp' }
            ],
            onSelect: function(a) {
                if (a.id == 'exp') { FullBackup.fileExport(); Lampa.Controller.toggle('settings_component'); }
                else if (a.id == 'imp') { confirmAction(function() { FullBackup.fileImport(); }); }
                else {
                    setTimeout(function() {
                        Lampa.Select.show({
                            title: a.id == 'push' ? 'Відправити бекап: Оберіть профіль' : 'Отримати бекап: Оберіть профіль',
                            items: [
                                { title: '💻 Профіль: ПК (Основний)', id: 'pc' },
                                { title: '📺 Профіль: ТВ', id: 'tv' },
                                { title: '📱 Профіль: Телефон', id: 'phone' }
                            ],
                            onSelect: function(prof) {
                                confirmAction(function() {
                                    if (a.id == 'push') FullBackup.goPush(true, prof.id);
                                    else FullBackup.goPull(true, prof.id);
                                });
                            },
                            onBack: function() { openBackupMenu(); }
                        });
                    }, 50);
                }
            },
            onBack: function() { Lampa.Controller.toggle('settings_component'); }
        });
    }

    // ==========================================
    // 1.5 ПОВНА СИНХРОНІЗАЦІЯ (УСЕ РАЗОМ)
    // ==========================================
    var UnifiedSync = {
        goPush: function(manual) {
            if (manual) Lampa.Noty.show('Відправка всіх даних...');
            var totalRequests = 3, completedRequests = 0, errors = 0;

            function checkDone() {
                completedRequests++;
                if (completedRequests >= totalRequests) {
                    if (errors === 0 && manual) Lampa.Noty.show('Усі дані успішно відправлено в хмару');
                    else if (manual) Lampa.Noty.show('Деякі дані не вдалося відправити');
                }
            }

            var now = Date.now(), pluginsData = localStorage.getItem('plugins');
            if (!pluginsData || typeof pluginsData !== 'string' || pluginsData.trim() === '') pluginsData = '[]';
            
            Lampa.Storage.set('fb_plugins_ts', now, true);
            fbRequest('PUT', 'plugins_sync', { data: pluginsData, _timestamp: now }, function() {
                var text = new Date().toLocaleString('uk-UA') + ' (Відправка)';
                Lampa.Storage.set('fb_plugins_last_time', text); updateMenuStatus('fb_status_plugins', text);
                checkDone();
            }, function() { errors++; checkDone(); });

            var syncData = DataSync.getPushData(true);
            if (syncData) {
                fbRequest('PATCH', 'global_sync', syncData, function() {
                    for (var k in syncData) {
                        DataSync.syncedCache[k] = JSON.stringify(syncData[k].data);
                        delete DataSync.outbox[k];
                    }
                    DataSync.saveOutbox();
                    var text = new Date().toLocaleString('uk-UA') + ' (Відправка)';
                    Lampa.Storage.set('fb_sync_last_time', text); updateMenuStatus('fb_status_sync', text);
                    checkDone();
                }, function() { errors++; checkDone(); });
            } else { checkDone(); }

            var tcData = TimecodesSync.getPushData(true);
            if (tcData) {
                fbRequest('PATCH', 'global_timecodes', tcData, function() {
                    for (var h in tcData) {
                        TimecodesSync.syncedCache[h] = TimecodesSync.formatCacheKey(tcData[h]);
                        delete TimecodesSync.outbox[h];
                    }
                    TimecodesSync.saveOutbox();
                    var text = new Date().toLocaleString('uk-UA') + ' (Відправка)';
                    Lampa.Storage.set('fb_tc_last_time', text); updateMenuStatus('fb_status_tc', text);
                    checkDone();
                }, function() { errors++; checkDone(); });
            } else { checkDone(); }
        },
        goPull: function(manual) {
            if (manual) Lampa.Noty.show('Завантаження всіх даних...');
            var totalRequests = 3, completedRequests = 0;
            var pendingUpdates = { plugins: null, sync: null, tc: null };

            function checkDone() {
                completedRequests++;
                if (completedRequests >= totalRequests) {
                    DataSync.isSyncingNow = true;

                    if (pendingUpdates.sync) {
                        for (var key in pendingUpdates.sync.data) {
                            Lampa.Storage.set(key, pendingUpdates.sync.data[key], true);
                        }
                        DataSync.saveLocalTs(pendingUpdates.sync.ts);
                        var textSync = new Date().toLocaleString('uk-UA') + ' (Отримання)'; 
                        Lampa.Storage.set('fb_sync_last_time', textSync, true); 
                        updateMenuStatus('fb_status_sync', textSync);
                    }
                    if (pendingUpdates.tc) {
                        TimecodesSync.saveAll(pendingUpdates.tc);
                        var textTc = new Date().toLocaleString('uk-UA') + ' (Отримання)'; 
                        Lampa.Storage.set('fb_tc_last_time', textTc, true); 
                        updateMenuStatus('fb_status_tc', textTc);
                    }
                    
                    refreshLampaUI();
                    setTimeout(function() { DataSync.isSyncingNow = false; }, 500);

                    // Плагіни: перезавантажуємо тільки якщо вони дійсно змінилися
                    if (pendingUpdates.plugins) {
                        window.lampac_firebase_reloading = true;
                        try { localStorage.setItem('plugins', pendingUpdates.plugins.data); } catch(e){}
                        Lampa.Storage.set('fb_plugins_ts', pendingUpdates.plugins.ts, true);
                        var textPlugins = new Date().toLocaleString('uk-UA') + ' (Отримання)';
                        Lampa.Storage.set('fb_plugins_last_time', textPlugins, true); 
                        updateMenuStatus('fb_status_plugins', textPlugins);
                        reloadApp(manual ? 'Плагіни відновлено з хмари' : '🔄 Синхронізація плагінів');
                        return;
                    }

                    if (manual) Lampa.Noty.show('Усі дані успішно відновлено з хмари');
                }
            }

            fbRequest('GET', 'plugins_sync', null, function(json) {
                if (json && json.data) {
                    var cloudDataStr = typeof json.data === 'string' ? json.data : JSON.stringify(json.data);
                    var cloudTs = parseInt(json._timestamp) || 0;
                    var localTs = parseInt(Lampa.Storage.get('fb_plugins_ts', 0)) || 0;
                    var localData = localStorage.getItem('plugins') || '[]';
                    var isDiff = isDataDifferent(cloudDataStr, localData);
                    
                    if (cloudTs > localTs && isDiff) { 
                        pendingUpdates.plugins = { data: cloudDataStr, ts: cloudTs }; 
                    } else if (cloudTs > localTs && !isDiff) {
                        Lampa.Storage.set('fb_plugins_ts', cloudTs, true);
                    }
                }
                checkDone();
            }, checkDone);

            fbRequest('GET', 'global_sync', null, function(cloud) {
                if (cloud) {
                    var localTs = DataSync.getLocalTs(), hasChanges = false, syncDataToApply = {};
                    for (var key in cloud) {
                        if (sync_keys.indexOf(key) !== -1 && cloud[key] && cloud[key]._timestamp !== undefined) {
                            var cTs = parseInt(cloud[key]._timestamp) || 0, lTs = parseInt(localTs[key]) || 0;
                            var localVal = Lampa.Storage.get(key);
                            var isDiff = isDataDifferent(cloud[key].data, localVal);
                            if ((cTs > lTs || manual) && cloud[key].data && isDiff) { 
                                syncDataToApply[key] = cloud[key].data; 
                                DataSync.syncedCache[key] = JSON.stringify(cloud[key].data);
                                localTs[key] = cTs; hasChanges = true; 
                                if (DataSync.outbox[key]) delete DataSync.outbox[key];
                            } else if (cTs > lTs && !isDiff) {
                                localTs[key] = cTs;
                                DataSync.syncedCache[key] = JSON.stringify(localVal);
                                if (DataSync.outbox[key]) delete DataSync.outbox[key];
                            } else if (cTs === lTs) {
                                DataSync.syncedCache[key] = JSON.stringify(localVal);
                            }
                        }
                    }

                    // Перевіряємо локальні ключі: якщо новіші за хмару
                    sync_keys.forEach(function(key) {
                        var localVal = Lampa.Storage.get(key);
                        if (localVal !== undefined && localVal !== null) {
                            var cItem = cloud[key];
                            var cTs = cItem ? (parseInt(cItem._timestamp) || 0) : 0;
                            var lTs = parseInt(localTs[key]) || 0;
                            var isDiff = !cItem || isDataDifferent(cItem.data, localVal);
                            if (!cItem || (lTs > cTs && isDiff)) {
                                DataSync.enqueue(key);
                            }
                        }
                    });

                    DataSync.saveLocalTs(localTs);
                    DataSync.saveOutbox();
                    if (hasChanges) { pendingUpdates.sync = { data: syncDataToApply, ts: localTs }; }
                }
                checkDone();
            }, checkDone);

            fbRequest('GET', 'global_timecodes', null, function(remote) {
                if (remote) {
                    var local = TimecodesSync.getAll(), hasChanges = false, localUpdated = false;
                    for (var hash in remote) {
                        var rItem = normalizeTimecodeItem(remote[hash]); 
                        if (!rItem) continue;
                        
                        var lItem = local[hash];
                        var rTs = Math.max(rItem._timestamp, rItem.updated, 0);
                        var lTs = lItem ? Math.max(lItem._timestamp, lItem.updated, 0) : 0;
                        var isDiff = !lItem || isTimecodeDifferent(lItem, rItem);
                        
                        if ((rTs > lTs || manual) && isDiff) { 
                            var merged = mergeTimecode(lItem, rItem);
                            local[hash] = merged; hasChanges = true; localUpdated = true;
                            TimecodesSync.syncedCache[hash] = TimecodesSync.formatCacheKey(merged);
                            if (TimecodesSync.outbox[hash]) delete TimecodesSync.outbox[hash];
                        } else if (!isDiff) {
                            if (lItem && (!lItem._timestamp || lItem._timestamp < rTs)) {
                                lItem._timestamp = Math.max(lTs, rTs);
                                lItem.updated = lItem._timestamp;
                                localUpdated = true;
                            }
                            var mItem = lItem || rItem;
                            TimecodesSync.syncedCache[hash] = TimecodesSync.formatCacheKey(mItem);
                            if (TimecodesSync.outbox[hash]) delete TimecodesSync.outbox[hash];
                        }
                    }

                    // Перевіряємо локальні таймкоди: якщо новіші за хмару або відсутні
                    for (var lHash in local) {
                        var curLocal = normalizeTimecodeItem(local[lHash]);
                        if (!curLocal) continue;
                        var curRemote = remote[lHash] ? normalizeTimecodeItem(remote[lHash]) : null;
                        var cTs = curRemote ? Math.max(curRemote._timestamp, curRemote.updated, 0) : 0;
                        var curTs = Math.max(curLocal._timestamp, curLocal.updated, 0);

                        if (!curRemote || (curTs > cTs && isTimecodeDifferent(curLocal, curRemote))) {
                            TimecodesSync.enqueue(lHash, curLocal);
                        }
                    }

                    TimecodesSync.saveOutbox();
                    if (localUpdated && !hasChanges) {
                        TimecodesSync.saveAll(local);
                    }
                    if (hasChanges) { pendingUpdates.tc = local; }
                }
                checkDone();
            }, checkDone);
        }
    };

    // ==========================================
    // 2. СИСТЕМА КАСТОМНИХ ПОСИЛАНЬ
    // ==========================================
    var CustomLinkSync = {
        sendUrl: function(returnCtrl) {
            var rc = returnCtrl || 'settings_component';
            setTimeout(function() {
                Lampa.Input.edit({ title: 'Введіть URL для передачі', value: '', free: true, nosave: true }, function (new_val) {
                    if (new_val) {
                        Lampa.Noty.show('Відправка посилання...');
                        fbRequest('PUT', 'global_custom_link', { url: new_val, _timestamp: Date.now() }, function() {
                            Lampa.Noty.show('Посилання збережено у хмару');
                        }, function() { Lampa.Noty.show('Помилка збереження посилання'); });
                    }
                    setTimeout(function() { Lampa.Controller.toggle(rc); }, 10);
                });
            }, 300);
        },
        playUrl: function(returnCtrl) {
            var rc = returnCtrl || 'settings_component';
            Lampa.Noty.show('Завантаження посилання з хмари...');
            fbRequest('GET', 'global_custom_link', null, function(data) {
                if (data && data.url) {
                    var video = { title: 'Трансляція з хмари', url: data.url };
                    Lampa.Player.play(video); Lampa.Player.playlist([video]);
                } else { 
                    Lampa.Noty.show('Посилання не знайдено в хмарі'); 
                    setTimeout(function() { Lampa.Controller.toggle(rc); }, 10);
                }
            }, function() { 
                Lampa.Noty.show('Помилка завантаження посилання'); 
                setTimeout(function() { Lampa.Controller.toggle(rc); }, 10);
            });
        }
    };

    // ==========================================
    // 3. ЄДИНЕ ОНОВЛЕННЯ ПРИ ЗАПУСКУ (БЕЗ ПЕРЕЗАВАНТАЖЕНЬ)
    // ==========================================
    function initialUnifiedPull() {
        var totalRequests = 3, completedRequests = 0;
        var pendingUpdates = { plugins: null, sync: null, tc: null };

        function checkDone() {
            completedRequests++;
            if (completedRequests >= totalRequests) {
                applyInitialData();
            }
        }

        function applyInitialData() {
            DataSync.isSyncingNow = true;

            // 1. Застосовуємо історію та обране без перезавантаження
            if (pendingUpdates.sync) {
                for (var key in pendingUpdates.sync.data) {
                    try {
                        Lampa.Storage.set(key, pendingUpdates.sync.data[key], true);
                    } catch(e) {}
                }
                DataSync.saveLocalTs(pendingUpdates.sync.ts);
                var textSync = new Date().toLocaleString('uk-UA') + ' (Старт)'; 
                Lampa.Storage.set('fb_sync_last_time', textSync, true); 
                updateMenuStatus('fb_status_sync', textSync);
            }

            // 2. Застосовуємо таймкоди без перезавантаження
            if (pendingUpdates.tc) {
                TimecodesSync.saveAll(pendingUpdates.tc);
                var textTc = new Date().toLocaleString('uk-UA') + ' (Старт)'; 
                Lampa.Storage.set('fb_tc_last_time', textTc, true); 
                updateMenuStatus('fb_status_tc', textTc);
            }

            // Миттєво оновлюємо інтерфейс Lampa у пам'яті
            refreshLampaUI();

            setTimeout(function() { DataSync.isSyncingNow = false; }, 500);

            // 3. Плагіни: перезавантажуємо виключно якщо в хмарі з'явився новий або змінений плагін
            if (pendingUpdates.plugins) {
                window.lampac_firebase_reloading = true;
                try { localStorage.setItem('plugins', pendingUpdates.plugins.data); } catch(e){}
                Lampa.Storage.set('fb_plugins_ts', pendingUpdates.plugins.ts, true);
                var textPlugins = new Date().toLocaleString('uk-UA') + ' (Отримання)';
                Lampa.Storage.set('fb_plugins_last_time', textPlugins, true); 
                updateMenuStatus('fb_status_plugins', textPlugins);

                reloadApp('🔄 Синхронізація плагінів');
                return;
            }

            window.lampac_firebase_initial_pull_done = true;

            // Миттєво виштовхуємо будь-які локальні дані, збережені офлайн або новіші за хмару
            TimecodesSync.pushPending(false);
            DataSync.pushPending(false);

            if (pendingUpdates.sync || pendingUpdates.tc) {
                Lampa.Noty.show('Синхронізація: дані завантажено');
            }
        }

        fbRequest('GET', 'plugins_sync', null, function(pData) {
            if (pData && pData.data) {
                var cloudDataStr = typeof pData.data === 'string' ? pData.data : JSON.stringify(pData.data);
                var cTs = parseInt(pData._timestamp) || 0;
                var lTs = parseInt(Lampa.Storage.get('fb_plugins_ts', 0)) || 0;
                var lData = localStorage.getItem('plugins') || '[]';
                var isDiff = isDataDifferent(cloudDataStr, lData);
                
                if (cTs > lTs && isDiff) { 
                    pendingUpdates.plugins = { data: cloudDataStr, ts: cTs }; 
                } else if (cTs > lTs && !isDiff) {
                    Lampa.Storage.set('fb_plugins_ts', cTs, true);
                }
            }
            checkDone();
        }, checkDone);

        fbRequest('GET', 'global_sync', null, function(sData) {
            var lTsSync = DataSync.getLocalTs(), hasChangesSync = false, syncDataToApply = {};
            if (sData) {
                for (var key in sData) {
                    if (sync_keys.indexOf(key) !== -1 && sData[key] && sData[key]._timestamp !== undefined) {
                        var cTsSync = parseInt(sData[key]._timestamp) || 0, lTsKey = parseInt(lTsSync[key]) || 0;
                        var localVal = Lampa.Storage.get(key);
                        var isDiff = isDataDifferent(sData[key].data, localVal);
                        
                        if (cTsSync > lTsKey && sData[key].data && isDiff) {
                            syncDataToApply[key] = sData[key].data;
                            DataSync.syncedCache[key] = JSON.stringify(sData[key].data);
                            lTsSync[key] = cTsSync; hasChangesSync = true;
                            if (DataSync.outbox[key]) delete DataSync.outbox[key];
                        } else if (cTsSync > lTsKey && !isDiff) {
                            lTsSync[key] = cTsSync;
                            DataSync.syncedCache[key] = JSON.stringify(localVal);
                            if (DataSync.outbox[key]) delete DataSync.outbox[key];
                        } else if (cTsSync === lTsKey) {
                            DataSync.syncedCache[key] = JSON.stringify(localVal);
                        }
                    }
                }
            }

            // Перевіряємо локальні ключі: якщо новіші за хмару або відсутні у хмарі
            sync_keys.forEach(function(key) {
                var localVal = Lampa.Storage.get(key);
                if (localVal !== undefined && localVal !== null) {
                    var cItem = sData ? sData[key] : null;
                    var cTs = cItem ? (parseInt(cItem._timestamp) || 0) : 0;
                    var lTs = parseInt(lTsSync[key]) || 0;
                    var isDiff = !cItem || isDataDifferent(cItem.data, localVal);

                    if (!cItem || (lTs > cTs && isDiff)) {
                        DataSync.enqueue(key);
                    }
                }
            });

            DataSync.saveLocalTs(lTsSync);
            DataSync.saveOutbox();
            if (hasChangesSync) { pendingUpdates.sync = { data: syncDataToApply, ts: lTsSync }; }

            checkDone();
        }, checkDone);

        fbRequest('GET', 'global_timecodes', null, function(tcData) {
            var localTc = TimecodesSync.getAll(), hasChangesTc = false, localUpdated = false;
            if (tcData) {
                for (var hash in tcData) {
                    var rItem = normalizeTimecodeItem(tcData[hash]); 
                    if (!rItem) continue;
                    
                    var lItem = localTc[hash];
                    var rTsTc = Math.max(rItem._timestamp, rItem.updated, 0);
                    var lTsTc = lItem ? Math.max(lItem._timestamp, lItem.updated, 0) : 0;
                    var isDiff = !lItem || isTimecodeDifferent(lItem, rItem);

                    if (rTsTc > lTsTc && isDiff) {
                        var merged = mergeTimecode(lItem, rItem);
                        localTc[hash] = merged;
                        hasChangesTc = true;
                        localUpdated = true;
                        TimecodesSync.syncedCache[hash] = TimecodesSync.formatCacheKey(merged);
                        if (TimecodesSync.outbox[hash]) delete TimecodesSync.outbox[hash];
                    } else if (!isDiff) {
                        if (lItem && (!lItem._timestamp || lItem._timestamp < rTsTc)) {
                            lItem._timestamp = Math.max(lTsTc, rTsTc);
                            lItem.updated = lItem._timestamp;
                            localUpdated = true;
                        }
                        var mItem = lItem || rItem;
                        TimecodesSync.syncedCache[hash] = TimecodesSync.formatCacheKey(mItem);
                        if (TimecodesSync.outbox[hash]) delete TimecodesSync.outbox[hash];
                    }
                }
            }

            // Перевіряємо локальні таймкоди: якщо новіші за хмару або взагалі відсутні
            for (var lHash in localTc) {
                var curLocal = normalizeTimecodeItem(localTc[lHash]);
                if (!curLocal) continue;
                var curRemote = (tcData && tcData[lHash]) ? normalizeTimecodeItem(tcData[lHash]) : null;
                var cTs = curRemote ? Math.max(curRemote._timestamp, curRemote.updated, 0) : 0;
                var curTs = Math.max(curLocal._timestamp, curLocal.updated, 0);

                if (!curRemote || (curTs > cTs && isTimecodeDifferent(curLocal, curRemote))) {
                    TimecodesSync.enqueue(lHash, curLocal);
                }
            }

            TimecodesSync.saveOutbox();
            if (localUpdated && !hasChangesTc) {
                TimecodesSync.saveAll(localTc);
            }
            if (hasChangesTc) { pendingUpdates.tc = localTc; }

            checkDone();
        }, checkDone);
    }

    // ==========================================
    // 4. КНОПКА ВИХОДУ ТА СИНХРОНІЗАЦІЇ
    // ==========================================
    function appExit() {
        if (Lampa.Platform.is('apple_tv')) window.location.assign('exit://exit');
        if (Lampa.Platform.is("tizen")) tizen.application.getCurrentApplication().exit();
        if (Lampa.Platform.is("webos")) window.close();
        if (Lampa.Platform.is("android")) Lampa.Android.exit();
        if (Lampa.Platform.is("orsay")) Lampa.Orsay.exit();
        if (Lampa.Platform.is("nw")) nw.Window.get().close();
        window.close();
    }

    function syncAndExit() {
        Lampa.Noty.show('Синхронізація перед виходом...');
        var totalRequests = 2, completedRequests = 0;
        var exitTimeout = setTimeout(appExit, 5000); 
        
        function checkDone() {
            completedRequests++;
            if (completedRequests >= totalRequests) { clearTimeout(exitTimeout); appExit(); }
        }

        var syncData = DataSync.getPushData(false);
        if (syncData) fbRequest('PATCH', 'global_sync', syncData, checkDone, checkDone); else checkDone();

        var tcData = TimecodesSync.getPushData(false);
        if (tcData) fbRequest('PATCH', 'global_timecodes', tcData, checkDone, checkDone); else checkDone();
    }

    function flushImmediateSync() {
        if (!window.lampac_firebase_initial_pull_done || window.lampac_firebase_reloading) return;
        try {
            TimecodesSync.scanLocalChanges(false);
            TimecodesSync.pushPending(true);
            DataSync.scanLocalChanges(false);
            DataSync.pushPending(true);
        } catch(e) {}
    }

    window.addEventListener('beforeunload', flushImmediateSync);
    window.addEventListener('pagehide', flushImmediateSync);
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') {
            flushImmediateSync();
        } else if (document.visibilityState === 'visible') {
            if (window.lampac_firebase_initial_pull_done && !window.lampac_firebase_reloading) {
                TimecodesSync.pushPending(false);
                DataSync.pushPending(false);
                TimecodesSync.goPull(false);
                DataSync.goPull(false);
            }
        }
    });

    window.addEventListener('focus', function() {
        if (window.lampac_firebase_initial_pull_done && !window.lampac_firebase_reloading) {
            TimecodesSync.pushPending(false);
            DataSync.pushPending(false);
            TimecodesSync.goPull(false);
            DataSync.goPull(false);
        }
    });

    window.addEventListener('online', function() {
        if (window.lampac_firebase_initial_pull_done && !window.lampac_firebase_reloading) {
            TimecodesSync.pushPending(false);
            DataSync.pushPending(false);
        }
    });

    function addTopMenuExitBtn() {
        if ($('.head__action.open--exit_custom').length) return; 

        var ico = '<svg version="1.1" viewBox="0 0 512 512" style="width: 2.2em; height: 2.2em;" xml:space="preserve"><path fill="currentColor" d="M256,5.1c138.6,0,250.9,112.3,250.9,250.9S394.6,506.9,256,506.9S5.1,394.6,5.1,256S117.4,5.1,256,5.1z M256,40.1C136.7,40.1,40.1,136.7,40.1,256S136.7,471.9,256,471.9S471.9,375.3,471.9,256S375.3,40.1,256,40.1z M311.4,176.6 c6.7-6.7,17.5-6.7,24.2,0c6.7,6.7,6.7,17.5,0,24.2l-55.1,55.1l55.1,55c6.7,6.7,6.7,17.5,0,24.2c-6.7,6.7-17.5,6.7-24.2,0L256.3,280 l-55.1,55.1c-6,6-15.4,6.6-22.1,1.8l-2.2-1.8c-6.7-6.7-6.7-17.5,0-24.2l55.1-55l-55.1-55c-6.7-6.7-6.7-17.5,0-24.2s17.5-6.7,24.2,0 l55.1,55.1L311.4,176.6z"/></svg>';
        var exit_btn = $('<div class="head__action selector open--exit_custom" title="Вихід / Хмара">' + ico + '</div>');
        
        exit_btn.on("hover:enter click", function () {
            Lampa.Select.show({
                title: 'Вихід / Хмара',
                items:[
                    { title: '🚪 Вийти з Lampa', id: 'exit' },
                    { title: '🔄 Синхронізація та вихід', id: 'sync_exit' },
                    { title: '📤 Відправити посилання', id: 'send_cloud' },
                    { title: '▶️ Відтворити з хмари', id: 'play_cloud' }
                ],
                onSelect: function(a) {
                    if (a.id == 'exit') appExit();
                    else if (a.id == 'sync_exit') syncAndExit();
                    else if (a.id == 'send_cloud') CustomLinkSync.sendUrl('head');
                    else if (a.id == 'play_cloud') CustomLinkSync.playUrl('head');
                },
                onBack: function() { Lampa.Controller.toggle('head'); }
            });
        });

        if ($('.head__actions').length) $('.head__actions').append(exit_btn);
        else $('.head').append(exit_btn);
    }

    // ==========================================
    // 6. СИНХРОНІЗАЦІЯ НАЛАШТУВАНЬ ПЛАГІНУ (Парсинг коду)
    // ==========================================
    var PluginSettingsSync = {
        openMenu: function() {
            var pData = localStorage.getItem('plugins'), plugins = [];
            try { if (pData) plugins = JSON.parse(pData); } catch(e) {}
            if (!plugins || plugins.length === 0) { Lampa.Noty.show('Немає встановлених плагінів'); return; }

            var items = plugins.map(function(p, index) {
                var name = p.name || p.url || 'Плагін ' + (index + 1);
                return { title: '🧩 ' + name, plugin: p, name: name };
            });

            Lampa.Select.show({
                title: 'Синхр. налаштувань плагіна',
                items: items,
                onSelect: function(a) { PluginSettingsSync.processPlugin(a.plugin, a.name); },
                onBack: function() { Lampa.Controller.toggle('settings_component'); }
            });
        },
        
        processPlugin: function(plugin, pName) {
            Lampa.Noty.show('Аналіз коду плагіну...');
            
            var fallbackPrefix = pName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/^_+|_+$/g, '') || 'plugin_data';
            
            if (plugin.url && plugin.url.indexOf('http') === 0) {
                $.ajax({
                    url: plugin.url,
                    dataType: 'text',
                    timeout: 5000,
                    success: function(code) {
                        var foundKeys = [];
                        var regex = /(?:Storage\.get|Storage\.set|localStorage\.getItem|localStorage\.setItem|Lampa\.Storage\.get|Lampa\.Storage\.set)\s*\(\s*['"]([^'"]+)['"]/g;
                        var match;
                        while ((match = regex.exec(code)) !== null) {
                            var k = match[1];
                            if (['true','false','0','1','','plugins','torrents_view'].indexOf(k) === -1) {
                                if (foundKeys.indexOf(k) === -1) foundKeys.push(k);
                            }
                        }
                        
                        var existingKeys = [];
                        foundKeys.forEach(function(fk) {
                            for (var i = 0; i < localStorage.length; i++) {
                                var locKey = localStorage.key(i);
                                if (locKey === fk || locKey.indexOf(fk + '_') === 0) {
                                    if (existingKeys.indexOf(locKey) === -1) existingKeys.push(locKey);
                                }
                            }
                        });

                        var resultString = existingKeys.length > 0 ? existingKeys.join(',') : fallbackPrefix;
                        PluginSettingsSync.showSyncAction(pName, resultString);
                    },
                    error: function() { PluginSettingsSync.showSyncAction(pName, fallbackPrefix); }
                });
            } else { PluginSettingsSync.showSyncAction(pName, fallbackPrefix); }
        },

        showSyncAction: function(pName, keysString) {
            setTimeout(function() {
                Lampa.Select.show({
                    title: 'Налаштування: ' + pName,
                    items: [ { title: '⬆️ Відправити знайдене в хмару', id: 'push' }, { title: '⬇️ Завантажити з хмари', id: 'pull' } ],
                    onSelect: function(action) {
                        setTimeout(function() {
                            Lampa.Input.edit({
                                title: 'Знайдені ключі (через кому):',
                                value: keysString, free: true, nosave: true
                            }, function (finalKeys) {
                                if (finalKeys) {
                                    var safeId = pName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
                                    if (action.id === 'push') PluginSettingsSync.pushSettings(safeId, finalKeys);
                                    else PluginSettingsSync.pullSettings(safeId, finalKeys);
                                }
                                setTimeout(function() { Lampa.Controller.toggle('settings_component'); }, 10);
                            });
                        }, 300);
                    },
                    onBack: function() { PluginSettingsSync.openMenu(); }
                });
            }, 50);
        },

        pushSettings: function(safeId, keysString) {
            var keys = keysString.split(',').map(function(k){return k.trim();}).filter(Boolean);
            var data = {}, count = 0;

            keys.forEach(function(k) {
                for (var i = 0; i < localStorage.length; i++) {
                    var localKey = localStorage.key(i);
                    if (localKey === k || localKey.indexOf(k + '_') === 0) {
                        data[localKey] = localStorage.getItem(localKey);
                        count++;
                    }
                }
            });

            if (count === 0) { Lampa.Noty.show('Не знайдено жодних даних для цих ключів'); return; }

            Lampa.Noty.show('Відправка налаштувань (' + count + ' записів)...');
            fbRequest('PUT', 'plugin_settings_' + safeId, { data: JSON.stringify(data), _timestamp: Date.now() }, function() {
                Lampa.Noty.show('Налаштування плагіну збережено у хмару!');
            });
        },

        pullSettings: function(safeId, keysString) {
            Lampa.Noty.show('Пошук налаштувань в хмарі...');
            fbRequest('GET', 'plugin_settings_' + safeId, null, function(res) {
                if (res && res.data) {
                    try {
                        var data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
                        var count = 0;
                        for (var k in data) { localStorage.setItem(k, data[k]); count++; }
                        reloadApp('Налаштування плагіну завантажено (' + count + ' записів)');
                    } catch(e) { Lampa.Noty.show('Помилка формату'); }
                } else { Lampa.Noty.show('В хмарі немає збережених налаштувань для цього плагіну'); }
            });
        }
    };


    // ==========================================
    // ІНІЦІАЛІЗАЦІЯ ІНТЕРФЕЙСУ
    // ==========================================
    var ModulesObj = { 'plugins': PluginsSync, 'sync': DataSync, 'tc': TimecodesSync };

    function openSubMenu(moduleKey, titleText) {
        Lampa.Select.show({
            title: titleText,
            items:[
                { title: '⬆️ Відправити в хмару', id: 'push' }, { title: '⬇️ Отримати з хмари', id: 'pull' },
                { title: '💾 Зберегти у файл', id: 'exp' }, { title: '📂 Завантажити з файлу', id: 'imp' }
            ],
            onSelect: function(a) {
                if (a.id == 'exp') { ModulesObj[moduleKey].fileExport(); Lampa.Controller.toggle('settings_component'); } 
                else if (a.id == 'push') { confirmAction(function() { ModulesObj[moduleKey].goPush(true); }); } 
                else if (a.id == 'pull') { confirmAction(function() { ModulesObj[moduleKey].goPull(true); }); } 
                else if (a.id == 'imp') { confirmAction(function() { ModulesObj[moduleKey].fileImport(); }); }
            },
            onBack: function() { Lampa.Controller.toggle('settings_component'); }
        });
    }

    function initPlugin() {
        try {
            window.lampac_firebase_unified_plugin = true;
            
            Lampa.SettingsApi.addComponent({
                component: 'firebase_unified_menu',
                icon: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19C19.9853 19 22 16.9853 22 14.5C22 12.1158 20.1477 10.1691 17.8016 10.0101C17.3697 6.61114 14.4746 4 11 4C7.13401 4 4 7.13401 4 11C4 11.237 4.01183 11.4713 4.03487 11.7018C2.30252 12.3582 1 14.0253 1 16C1 18.2091 2.79086 20 5 20H17H17.5Z"></path><path d="M12 12V21M12 12L9 15M12 12L15 15"></path></svg>',
                name: 'Синхронізація (Firebase)'
            });

    Lampa.SettingsApi.addParam({
    component: 'firebase_unified_menu',
    param: { type: 'button' },
    field: { name: '🔐 Email / пароль Firebase' },
    onChange: function() {
        editFirebaseCredentials();
    }
    });

            Lampa.SettingsApi.addParam({ component: 'firebase_unified_menu', param: { type: 'button' }, field: { name: '📤 Відправити все в хмару (Повна синхронізація)' }, onChange: function() { confirmAction(function() { UnifiedSync.goPush(true); }); } });
            Lampa.SettingsApi.addParam({ component: 'firebase_unified_menu', param: { type: 'button' }, field: { name: '📥 Отримати все з хмари (Повна синхронізація)' }, onChange: function() { confirmAction(function() { UnifiedSync.goPull(true); }); } });
            
            Lampa.SettingsApi.addParam({
                component: 'firebase_unified_menu', param: { type: 'button' }, field: { name: '🔗 Робота з посиланнями' },
                onChange: function() { 
                    Lampa.Select.show({
                        title: 'Робота з посиланням', items:[ { title: '📤 Передати посилання', id: 'send' }, { title: '▶️ Відтворити посилання', id: 'play' } ],
                        onSelect: function(a) { 
                            if (a.id == 'send') CustomLinkSync.sendUrl('settings_component'); 
                            else CustomLinkSync.playUrl('settings_component'); 
                        },
                        onBack: function() { Lampa.Controller.toggle('settings_component'); }
                    });
                }
            });

            Lampa.SettingsApi.addParam({ component: 'firebase_unified_menu', param: { type: 'button' }, field: { name: '🔌 Налаштування конкретних плагінів' }, onChange: function() { PluginSettingsSync.openMenu(); } });

            Lampa.SettingsApi.addParam({ component: 'firebase_unified_menu', param: { type: 'button' }, field: { name: '🧩 Плагіни <span id="fb_status_plugins" style="float:right; color:#a9a9a9; font-size: 0.9em;">' + Lampa.Storage.get('fb_plugins_last_time', 'Ніколи') + '</span>' }, onChange: function() { openSubMenu('plugins', 'Плагіни'); } });
            Lampa.SettingsApi.addParam({ component: 'firebase_unified_menu', param: { type: 'button' }, field: { name: '⭐ Обране / Історія <span id="fb_status_sync" style="float:right; color:#a9a9a9; font-size: 0.9em;">' + Lampa.Storage.get('fb_sync_last_time', 'Ніколи') + '</span>' }, onChange: function() { openSubMenu('sync', 'Обране та Історія'); } });
            Lampa.SettingsApi.addParam({ component: 'firebase_unified_menu', param: { type: 'button' }, field: { name: '⏱ Таймкоди <span id="fb_status_tc" style="float:right; color:#a9a9a9; font-size: 0.9em;">' + Lampa.Storage.get('fb_tc_last_time', 'Ніколи') + '</span>' }, onChange: function() { openSubMenu('tc', 'Таймкоди'); } });
            Lampa.SettingsApi.addParam({ component: 'firebase_unified_menu', param: { type: 'button' }, field: { name: '📦 Повний Бекап (Усі налаштування)' }, onChange: function() { openBackupMenu(); } });

            Lampa.Listener.follow('settings', function(e) {
                if (e.name == 'firebase_unified_menu') {
                    updateMenuStatus('fb_status_plugins', Lampa.Storage.get('fb_plugins_last_time', 'Ніколи'));
                    updateMenuStatus('fb_status_sync', Lampa.Storage.get('fb_sync_last_time', 'Ніколи'));
                    updateMenuStatus('fb_status_tc', Lampa.Storage.get('fb_tc_last_time', 'Ніколи'));
                }
            });
            
            var tcPushTimer = null;
            function scheduleTimecodePush(delay) {
                if (!window.lampac_firebase_initial_pull_done || window.lampac_firebase_reloading) return;
                clearTimeout(tcPushTimer);
                var waitTime = typeof delay === 'number' ? delay : 400;
                if (waitTime === 0) {
                    TimecodesSync.autoPush();
                } else {
                    tcPushTimer = setTimeout(function() {
                        TimecodesSync.autoPush();
                    }, waitTime);
                }
            }

            window.lampac_timecodes_sync = TimecodesSync;
            
            Lampa.Storage.listener.follow('change', function(e) {
                if (!window.lampac_firebase_initial_pull_done || window.lampac_firebase_reloading || DataSync.isSyncingNow) return;
                if (sync_keys.indexOf(e.name) !== -1) { 
                    clearTimeout(DataSync.pushTimers[e.name]); 
                    DataSync.pushTimers[e.name] = setTimeout(function() { DataSync.pushSingle(e.name); }, 1000); 
                }
                var primaryTcKey = TimecodesSync.getPrimaryStorageKey();
                if (e.name === primaryTcKey || e.name === 'file_view' || (typeof e.name === 'string' && e.name.indexOf('file_view') === 0)) {
                    scheduleTimecodePush(400);
                }
            });

            if (window.Lampa && Lampa.Timeline && Lampa.Timeline.listener && typeof Lampa.Timeline.listener.follow === 'function') {
                Lampa.Timeline.listener.follow('update', function(e) {
                    scheduleTimecodePush(400);
                });
            }

            Lampa.Listener.follow('state:changed', function(e) {
                if (e && e.target === 'timeline') {
                    scheduleTimecodePush(400);
                }
            });

            if (window.Lampa && Lampa.Player && Lampa.Player.listener && typeof Lampa.Player.listener.follow === 'function') {
                Lampa.Player.listener.follow('destroy', function() {
                    scheduleTimecodePush(0); // миттєве збереження таймкодів при закритті плеєра
                });
                Lampa.Player.listener.follow('stop', function() {
                    scheduleTimecodePush(0); // миттєве збереження таймкодів при зупинці плеєра
                });
            }

            // Відновлюємо невідправлені outbox черги зі сховища (якщо попередній сеанс було примусово закрито)
            TimecodesSync.initOutbox();
            DataSync.initOutbox();

            // Періодичне виштовхування черги outbox (раз на 30 сек)
            setInterval(function() {
                if (window.lampac_firebase_initial_pull_done && !window.lampac_firebase_reloading) {
                    TimecodesSync.autoPush();
                    DataSync.pushPending(false);
                }
            }, 30000);

            // Періодичне фонове отримання нових даних для приймаючого пристрою (Windows/TV/Android) (раз на 60 сек)
            setInterval(function() {
                if (window.lampac_firebase_initial_pull_done && !window.lampac_firebase_reloading) {
                    if (!TimecodesSync.isPushing) TimecodesSync.goPull(false);
                    if (!DataSync.isPushing) DataSync.goPull(false);
                }
            }, 60000);

            // ЗАПУСК ЄДИНОГО ОНОВЛЕННЯ ДАНИХ ПРИ СТАРТІ (БЕЗ ПЕРЕЗАВАНТАЖЕННЯ)
            initialUnifiedPull();
            
        } catch(e) { console.log("Firebase Sync Plugin Init Error: ", e); }
    }

    var checkTimer = setInterval(function() {
        if (window.Lampa && window.Lampa.SettingsApi && window.Lampa.Storage && typeof window.Lampa.Platform !== "undefined") {
            if ($('.head__actions').length && !$('.head__action.open--exit_custom').length) addTopMenuExitBtn();
            if (!window.lampac_firebase_unified_plugin) initPlugin();
            if (window.lampac_firebase_unified_plugin && $('.head__action.open--exit_custom').length) clearInterval(checkTimer);
        }
    }, 500);

})();