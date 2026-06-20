/*
 * Vela Quantum Nexus — Service Worker
 *
 * scope: /dashboard/
 *
 * 캐시 전략:
 *   1) API / 동적 endpoint   → network-only  (snapshot 등 항상 최신)
 *   2) HTML / navigation     → network-first (실패 시만 캐시 셸 폴백)
 *   3) 정적 자산(아이콘·manifest·SW 자체) → stale-while-revalidate
 *
 * 버전 갱신:
 *   - dashboard.html / REQUIRED_SHELL / OPTIONAL_ASSETS 가 바뀌면 CACHE_VERSION +1.
 *   - install 에서 skipWaiting, activate 에서 옛 캐시 전부 삭제 + clients.claim
 *     → 새 SW 가 즉시 컨트롤. dashboard.html 의 controllerchange 핸들러가
 *       페이지를 자동 reload 해 새 셸을 표시한다.
 */
// v10.8 — 홈 '일지 · 최근 8건' 섹션의 시각이 '— · —' 로 표시되던 버그 수정.
//         원인: renderJournal 이 notif/layer3 항목에서 잘못된 필드명(timestamp/at)을
//         읽어 ts=undefined → _kstTimeShort/_kstDateShort 가 둘 다 '—' 반환.
//         실 필드명은 양쪽 모두 'ts'. PC·폰 공유 렌더러라 양쪽 동시 깨졌던 것.
//         v10.7 이 고친 곳은 하단 history 탭(다른 렌더러)이라 홈 일지에 무효.
// v10.7 — dashboard.html 폰 history 탭 시각 표시 버그 수정 (notif.recent 의 'ts'
//         필드 미연결로 '—' 출력되던 회귀). 표시 계층만, 매매·Aegis·미러 로직
//         무변경. 캐시 무효화 위해 버전 bump.
// v10.6 — Phase 2.13 패치 B: install precache 신뢰성. 셸('/dashboard/') 은
//         반드시 캐시되어야 폴백 체인이 동작 — 3회 재시도(0/500/1500ms 백오프)
//         + 옛 캐시 inherit, 모두 실패 시 install throw (silent fail 금지).
//         networkFirstHtml 폴백 안전망 — 캐시 셸이 비었으면 그 시점에 한 번 더
//         받아 채움. (들쭉날쭉의 직접 원인: silent precache 실패로 폰 셸 캐시가
//         빔 → SW 폴백 체인 첫 단계가 끊겨 Firestore 폴백까지 도달 못함)
// v10.5 — 폰 헤더 재디자인 (시안 B) + 버전 동적 표시.
//         메시지 핸들러에 GET_VERSION 추가 — 페이지가 SW 의 CACHE_VERSION 을
//         읽어 헤더 메타 / 설정 탭 버전 정보 카드에 표시.
// v10.4 — Phase 2.13 패치 A: networkFirstHtml 이 502/503/504 게이트웨이 에러를
//         네트워크 실패로 분류하여 캐시 셸 폴백으로 빠지게 수정.
//         (Tailscale serve 가 PC 백엔드 다운 시 502 반환 → 기존엔 fetch promise 가
//          resolve 되어 .catch 미실행 → 폰에 502 그대로 노출되던 버그)
// v11.1 — 설정 탭에 백엔드 URL 입력칸 카드 추가 (모바일/PC 양쪽).
//          기존 nexus_backend_url localStorage 메커니즘 재사용. 새 빌드 캐시 무효화.
// v11.0 — Phase A: GitHub Pages 분리 빌드. 셸 자산 경로 /dashboard/ → /nexus/.
//          PC 백엔드 직결 + Firestore 폴백 로직은 무손 (이미 양쪽 와이어드).
// v10.3 — Phase 2.13: Firestore mirror 폴백 + 오프라인 배너 (dashboard.html)
// v11.2 — 설정 탭 "개발 로그" 카드 + /dev-log API (표시 전용, 매매 무관)
// v11.3 — dev_log entry tokens_detail 구조 + 카드 "추정" 명시 렌더
// v11.4 — 홈 정리: 카운트다운/Aegis 셀 중복 제거, 방어판→보유, 계층3→이력, 액션→설정
// v11.5 — Chart.js 도입: NAV 라인 + PM 도넛 + 리스크 게이지 + 색·글씨 통일
// v11.6 — 캘린더 그리드 + 게이지 SVG 텍스트 정중앙 + 게이지 색 분리 + PM 한국 이름·색 통일
// v11.7 — PC 도넛 범례 HTML 화 (흰색) + 달력 컴팩트 + 상세 풍부 + D-day 리스트 제거
const CACHE_VERSION = 'v11.7';
const CACHE_NAME = 'nexus-cache-' + CACHE_VERSION;

// 셸 — PC Stop 시 networkFirstHtml 폴백의 유일한 통로. 반드시 캐시되어야 함.
const REQUIRED_SHELL = '/nexus/dashboard.html';

// 부속 자산 — best-effort. 셸만 있으면 앱은 떠서 Firestore 폴백 동작.
const OPTIONAL_ASSETS = [
  '/nexus/nexus-manifest.json',
  '/nexus/nexus-icon-192.png',
  '/nexus/nexus-icon-512.png',
  '/nexus/nexus-icon-maskable.png',
];

// =========================================================
// classifier — request → 캐시 전략 1/2/3
// =========================================================
function isApiRequest(url) {
  const p = url.pathname;
  if (p.indexOf('/dashboard/api/') === 0) return true;
  if (p.indexOf('/api/') === 0) return true;
  if (p.indexOf('/snapshot') >= 0) return true;
  if (p.indexOf('/health') === 0) return true;
  if (p.indexOf('/layer3/') === 0) return true;
  if (p.indexOf('/aegis/') === 0) return true;
  if (p.indexOf('/broker/') === 0) return true;
  if (p.indexOf('/recovery/') === 0) return true;
  if (p.indexOf('/briefing') === 0) return true;
  if (p.indexOf('/tide') === 0) return true;
  if (p.indexOf('/night_watch') === 0) return true;
  if (p.indexOf('/pathfinder') === 0) return true;
  if (p.indexOf('/telegram') === 0) return true;
  if (p.indexOf('/kill_switch') === 0) return true;
  if (p.indexOf('/audit') === 0) return true;
  if (p.indexOf('/dev-log') === 0) return true;
  return false;
}

function isHtmlRequest(request, url) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  if (accept.indexOf('text/html') >= 0) return true;
  // nexus 진입 경로 (확장자 없음)
  const p = url.pathname;
  if (p === '/nexus' || p === '/nexus/') return true;
  if (p.endsWith('.html')) return true;
  return false;
}

// 정적 자산: PNG·SVG·manifest·sw.js·아이콘 등 (확장자 기반)
function isStaticAsset(url) {
  const p = url.pathname;
  if (p.indexOf('/nexus/nexus-') === 0) return true;
  return /\.(png|svg|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf|otf|json)$/i.test(p);
}

// =========================================================
// install — 셸 precache (필수) + 부속 자산 (best-effort) + 즉시 활성화
// =========================================================
// 셸 ('/dashboard/') 은 PC Stop 시 폴백의 유일한 통로 — 반드시 캐시되어야 한다.
// 종래 SHELL_ASSETS.map(...).catch(null) 의 silent fail 이 들쭉날쭉 회귀의 직접
// 원인이었음 (v10.6 패치 B).
//   1) cache: 'reload' 로 브라우저 HTTP 캐시 우회 — 항상 최신 셸 받기.
//   2) 실패 시 3회 재시도 (0 / 500 / 1500 ms 백오프) — Tailscale serve 지연 대비.
//   3) 그래도 실패하면 옛 캐시(다른 버전 포함)에서 셸 복제 — graceful inherit.
//   4) 정말 모두 실패하면 throw — install 실패 → 옛 SW 컨트롤 유지(있으면).
// 부속 자산(아이콘·manifest)은 개별 실패 무시 — 셸만 있으면 폴백 동작.

async function _precacheShellRequired(cache) {
  const BACKOFF_MS = [0, 500, 1500];
  let lastErr = null;
  for (let i = 0; i < BACKOFF_MS.length; i++) {
    if (BACKOFF_MS[i]) {
      await new Promise(function(r) { setTimeout(r, BACKOFF_MS[i]); });
    }
    try {
      const req = new Request(REQUIRED_SHELL, { cache: 'reload' });
      const res = await fetch(req);
      if (!res || !res.ok) {
        throw new Error('shell status ' + (res ? res.status : 'null'));
      }
      await cache.put(REQUIRED_SHELL, res);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  // 모든 재시도 실패 — 다른(옛 버전) 캐시에 셸이 있으면 새 캐시로 복제.
  try {
    const inherited = await caches.match(REQUIRED_SHELL);
    if (inherited) {
      await cache.put(REQUIRED_SHELL, inherited.clone());
      return;
    }
  } catch (_) { /* ignore */ }
  // 폴백 통로 자체가 없으면 install 실패시켜 옛 SW 보존 — worse-off 방지.
  throw lastErr || new Error('shell precache exhausted');
}

async function _precacheOptional(cache) {
  await Promise.all(OPTIONAL_ASSETS.map(function(asset) {
    return cache.add(asset).catch(function() { return null; });
  }));
}

self.addEventListener('install', function(event) {
  event.waitUntil((async function() {
    const cache = await caches.open(CACHE_NAME);
    await _precacheShellRequired(cache);  // 셸 필수 — 실패 시 throw
    await _precacheOptional(cache);       // 부속 선택 — 개별 실패 silent OK
    await self.skipWaiting();
  })());
});

// =========================================================
// activate — 옛 버전 캐시 전부 삭제 + 열린 탭 즉시 컨트롤
// =========================================================
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) {
        if (k !== CACHE_NAME) {
          // 옛 버전(`nexus-cache-v2`, `nexus-shell-v1` 등) 전부 삭제
          return caches.delete(k);
        }
        return null;
      }));
    }).then(function() {
      // 열린 탭에 즉시 적용 → dashboard.html 의 controllerchange 가 reload
      return self.clients.claim();
    })
  );
});

// =========================================================
// 메시지 — 페이지에서 강제 skipWaiting 트리거 (수동 새로고침 버튼 등)
// =========================================================
self.addEventListener('message', function(event) {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'GET_VERSION') {
    // 페이지에서 SW 의 캐시 버전을 묻는 요청.
    // MessageChannel(ports[0]) 우선, 없으면 클라이언트 broadcast.
    var payload = { type: 'VERSION', version: CACHE_VERSION };
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage(payload);
    } else if (event.source && event.source.postMessage) {
      event.source.postMessage(payload);
    }
  }
});

// =========================================================
// fetch — 요청 분류 후 전략별 처리
// =========================================================
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  let url;
  try { url = new URL(event.request.url); }
  catch (e) { return; }

  // origin 외부 요청(CDN 폰트 등)은 SW 손대지 않음 → 브라우저 기본 처리
  if (url.origin !== self.location.origin) return;

  // (1) API / 동적 — network-only. 캐시 안 함, 폴백 없음.
  if (isApiRequest(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  // (2) HTML / navigation — network-first.
  //     성공 시 캐시 갱신 후 반환. 실패 시 캐시 셸 폴백.
  if (isHtmlRequest(event.request, url)) {
    event.respondWith(networkFirstHtml(event.request, url));
    return;
  }

  // (3) 정적 자산 — stale-while-revalidate.
  //     캐시 즉시 반환 + 백그라운드 갱신. 캐시 없으면 네트워크.
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // 그 외 — 네트워크 우선 + 캐시 폴백 (보수적 기본값)
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request).then(function(c) {
        return c || new Response('offline', { status: 503, statusText: 'offline' });
      });
    })
  );
});

// network-first (HTML 전용). 성공한 응답을 캐시에 저장(폴백용).
function networkFirstHtml(request, url) {
  return fetch(request).then(function(res) {
    // 502/503/504 = 백엔드 다운 신호 (Tailscale serve 가 uvicorn 못 잡을 때).
    // fetch 는 resolve 되지만 페이지에 그대로 노출되면 폰이 502 화면을 본다.
    // 명시적으로 throw 해서 아래 .catch 의 캐시 셸 폴백으로 빠뜨린다.
    if (!res || res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error('gateway_' + (res ? res.status : 'null'));
    }
    if (res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(function(cache) {
        cache.put(request, copy).catch(function() {});
      });
    }
    return res;
  }).catch(function() {
    // 네트워크 실패 — 캐시 셸로 폴백 (오프라인 진입 시 최소 화면)
    return caches.match(request).then(function(cached) {
      if (cached) return cached;
      if (url.pathname.indexOf('/nexus') === 0) {
        return caches.match(REQUIRED_SHELL).then(function(shell) {
          if (shell) return shell;
          // 안전망(v10.6 패치 B): 캐시에 셸이 없으면 지금 한 번 더 받아 채운다.
          // GitHub Pages 단순 정적 호스팅이라 백엔드와 무관하게 셸은 거의 항상 응답.
          return fetch(REQUIRED_SHELL, { cache: 'reload' }).then(function(rescue) {
            if (rescue && rescue.ok) {
              const copy = rescue.clone();
              caches.open(CACHE_NAME).then(function(cache) {
                cache.put(REQUIRED_SHELL, copy).catch(function() {});
              });
              return rescue;
            }
            return new Response('offline', { status: 503, statusText: 'offline' });
          }).catch(function() {
            return new Response('offline', { status: 503, statusText: 'offline' });
          });
        });
      }
      return new Response('offline', { status: 503, statusText: 'offline' });
    });
  });
}

// stale-while-revalidate (정적 자산 전용).
// 캐시가 있으면 즉시 반환 + 백그라운드에서 네트워크로 갱신.
function staleWhileRevalidate(request) {
  return caches.open(CACHE_NAME).then(function(cache) {
    return cache.match(request).then(function(cached) {
      const networkPromise = fetch(request).then(function(res) {
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
          cache.put(request, res.clone()).catch(function() {});
        }
        return res;
      }).catch(function() { return null; });

      if (cached) {
        // 캐시 hit — 즉시 반환. 갱신은 백그라운드에서.
        return cached;
      }
      // 캐시 miss — 네트워크 응답 기다림
      return networkPromise.then(function(res) {
        return res || new Response('offline', { status: 503, statusText: 'offline' });
      });
    });
  });
}
