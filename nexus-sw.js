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
// v11.8 — 개발 로그 자동 토큰 집계 (PC 백엔드 /dev-log 에서 enrich)
// v12.0 — PC 리뉴얼 1차: B안 사이드바 레이아웃(≥1100px) + 공용 상세 패널
//         + ? 도움말 엔진. 표시 계층만, 매매·Aegis·미러 로직 무변경.
//         모바일(<1100px) 세로 레이아웃은 무손 — PC 전용 미디어쿼리로 격리.
// v12.1 — PC 리뉴얼 2차: 보유 탭 B-layout. 3 요약 카드 + PM 필터 칩 + 포지션
//         테이블(실계좌/sim 구분 배지) + 방어 6선 ? 도움말. openDetailPanel
//         에 'position' 타입 추가. HELP_TEXTS 확장 (position · pnl · pm_owner
//         · sim_position · defense_lines). 백엔드 무손.
// v12.2 — PC 리뉴얼 3차: 이력 탭 B-layout. PM/유형/기간 3필터 · 일별 미니바(14D)
//         · 날짜 그룹 타임라인 · sim/live 모드 배지. openDetailPanel에 'trade'
//         타입 추가. HELP_TEXTS 확장 (timeline · daily_bar · trade_detail ·
//         skip_reason · mode_badge). 계층3 카드 위치 유지 + ? 부착. 백엔드 무손.
// v12.3 — PC 리뉴얼 4차: 승인 탭 B-layout. 대기 승인 카드 최상단 강조 + 2열
//         (달력|처리 이력) + 카드 클릭 상세 패널. openDetailPanel에 'approval'·
//         'event' 타입 추가. nexusApprovalDecide 동작 무손 (버튼 stopPropagation).
//         HELP_TEXTS 확장 (approval_queue · discovery_score · event_calendar ·
//         approval_history). 백엔드 무손.
// v12.4 — 보유 탭 PM 도넛 7 PM 대응: 하드코딩 3 PM 목록 (박세진/한도현/김선우)
//         제거 → data.team_desk.desks 순회. NexusCharts.COLORS.pm / PM_NAMES /
//         renderHoldingsSummary 의 PM_KO/PM_EN/PM_COLOR 맵 모두 삭제.
//         단일 소스로 window.NEXUS_PM_META (v12.0 정의) 재사용. mint·pulse 활성
//         시 자동 6~7조각. 합 100 검증 → 현금 조각 보정. hold-pm-row 색은
//         CSS 클래스 대신 inline background (data-driven). 백엔드 무손.
// v12.5 — PC 리뉴얼 5차 (최종): 설정 탭 B-layout. 4그룹 2컬럼 재편 (연결 · 운용
//         파라미터 · 개발 · 시스템) + 대시보드 버전 히스토리. "운용 파라미터"
//         카드 신설 (읽기전용, 스냅샷 실측만 표시 — 없는 필드는 항목 자체 생략,
//         하드코딩 금지). nexusSaveBackendUrl · nexusOpenBriefingModal ·
//         nexusOpenMandateModal 동작 무손 (배치만 변경). HELP_TEXTS 확장 8키
//         (backend_url · op_params · buy_threshold · pm_cap · rebalancer_status
//         · dev_log · token_usage · sw_version → 39키). 백엔드 무손.
// v12.6 — 오프라인 배너 오탐 수정. 판정 신호 분리.
//         이전: mirror 폴백(백엔드 정상)에서도 "오프라인 — 마지막 갱신 N분 전
//         (PC 꺼짐)" 배너가 상시 표시 → 장외·주말엔 스냅숏이 안 변하는 것을
//         'PC 꺼짐' 으로 오탐. 이후: (1) offline 배너 = 직결+미러 fetch 모두
//         연속 2회 실패 시에만 발동 ("오프라인 — 백엔드 응답 없음 · 마지막 성공
//         hh:mm"), fetch 성공 1회면 즉시 해제 (히스테리시스). (2) stale 배너 =
//         미국 정규장 진행 중 + 스냅숏 age > 5분 (노랑 "갱신 지연"). (3) 장외/
//         주말 = 배너 없음, 상태줄 "장외 · 마지막 평가 hh:mm" 소프트 표기.
//         HELP_TEXTS 확장 3키 (offline_banner · stale_warn · market_closed).
//         표시 계층만, 백엔드/매매/미러 fetch 로직 무변경.
// v12.7 — deploy 체계 복구 + NAV 폴백 오탐 수정 이식 (20260705). 이전 커밋에서
//         PC 원본(v10.x SW · /dashboard/ 절대경로)이 deploy(v12.x SW · /nexus/
//         상대경로)를 통복사로 덮은 혼합 오염을 되돌림. deploy 체계 유지하며
//         프론트 수정만 재이식: applyDashboard·_renderHoldingsEmpty 두 곳에서
//         value_krw 분기 제거, status=awaiting_broker면 '브로커 연결 대기'
//         표시. 매매·Aegis·방어 로직 무변경 (표시 계층만). 캐시 무효화 위해
//         버전 bump.
// v12.8 — 설정 탭 백엔드 URL 저장 버그 수정 (20260713). ≥1100px h5 레이아웃에서
//         저장 눌러도 "현재 저장 URL" 이 안 바뀌던 표시 계층 버그.
//         원인: (1) updateSettingsUI 가 cfg-backend-url-h5 · cfg-backend-state-h5
//         를 갱신하지 않음. (2) 세 input(mobile · d · h5) 을 모두 backend.url 로
//         pre-fill 하는데 nexusSaveBackendUrl 은 "첫 번째 값 있는 input" 을 골라
//         숨은 mobile input 의 옛 URL 이 h5 편집분을 덮음.
//         수정: (a) h5 URL·state·input 을 updateSettingsUI 에 추가. (b) 저장 시
//         backend.url 과 다른 값을 우선 (사용자 편집분). (c) localStorage 실패
//         감지 (setItem→getItem 확인) 후 조용한 실패 대신 배너로 사유 표시.
//         (d) ?backend=<url> 쿼리 지원 — 주소창만으로 백엔드 교체 가능.
//         표시·설정 계층만, 매매·Aegis·미러 로직 무변경. 캐시 무효화 위해 bump.
// v12.9 — 익명인증 코드 이식 (20260715). 폰 미러 read 복구의 마지막 조각.
//         Firebase Console 익명 인증 ON + rules 게시 완료 상태에서 코드만
//         뒤쳐져 있어 폰에서 nexus_mirror/latest 접근이 permission-denied 로
//         차단되던 문제. deploy dashboard.html 미러 스크립트에 firebase-auth
//         import + signInAnonymously + onAuthStateChanged 5s 폴백 이식.
//         PC(Tailscale) 직결 실패 시 폰이 Firestore 미러로 fallback 하도록
//         복구. 미러 read 계층만, 매매·Aegis·표시 로직 무변경. 캐시 무효화 bump.
// v13.0 — 감사 후속 일괄 반영 (20260715).
//         [1] 보유 탭 sim_portfolio.positions 원장 직결 (recent_would_trades
//              폴백은 원장 부재 시에만) — 42 포지션 실 수량·평단·현재가·PnL 노출.
//         [2] 모바일 보유·이력 탭 소스 교체 (sim ledger + layer3 병합).
//         [3] 상세 패널 필드명 수정 (_renderNavPanel week_pnl_pct→week_pct 등,
//              _renderMarketPanel m.spy→spy_last 등).
//         [4] 홈: sim 성과 카드(virtual_nav) + PM 손익 랭킹(pm_summary) 신설,
//              "sim 가상" 배지.
//         [5] 이력 탭 미니바 A안 교체 — 건수→금액(notional_usd) 스택, PM 색.
//         [5b] sim 체결 섹션 신설 (recent_ledger 20건).
//         [6] 기간 칩(15D/1M/3M/전체) 핸들러 구현 (nav_series 필터).
//         [7] 헌법 §4 갱신 (5인→7인 15/15/15/10/10 + mint/pulse 대기).
//         [8] 버전 히스토리 v12.7~13.0 추가.
//         [9] d-settings-grid 구 UI 항상 숨김 (h5-settings-block 전 폭).
//         백엔드 1건: sim_nav_history 신규 (KST 06:00 이후 append) — 다음
//              차수 sim NAV 곡선용 시계열 축적 시작 (표시는 이번 회차 안 함).
//         매매·Aegis·미러 로직 무변경. 캐시 무효화 bump.
// v13.1 — v13.0 회귀 4건 수정 (20260715).
//         [원인] renderSimBlock 이 다른 IIFE (line 10578) 소유의 _pmMeta 를
//         참조 → 크로스 IIFE ReferenceError → applyDashboard chain 폭발 →
//         window.nexusBackendData = data 미실행 → 이후 refreshFromSnapshot
//         이 {} 로 도는 데드락 → 홈 NAV / 보유 42 / 이력 미니바 / 승인 달력
//         전 탭 데이터 소실 (연쇄 지점 하나에서 4증상 유발).
//         [수정] (a) renderSimBlock 내부에 _pmMetaLocal/_escLocal 지역 헬퍼
//         (window.NEXUS_PM_META 참조 — v12.4 공식 크로스 IIFE 경로).
//         (b) applyDashboard 안 window.nexusBackendData = data 를 render
//         이전으로 이동 (안전망 · v13.0 은 render 뒤 set).
//         (c) 홈 각 render 를 개별 try/catch — 한 카드 예외가 다음 카드
//         죽이는 연쇄 재발 방지.
//         (d) renderPerformanceCard 곡선 직접 draw 복원 (인자로 받은
//         nav_series 를 _navPeriod 필터해 즉시 draw · window 우회 참조 X).
//         (e) sim 부재 문구 분리: "필드 없음" vs "값 0건" 구분.
//         매매·Aegis·미러 무손. 캐시 무효화 bump.
// v13.2 (20260715) — 실화면 피드백 반영. 버그 2 + UI 7.
//   [Bug1] 홈 Aegis '현금' 셀 '—' → renderAegisCard 에 portfolio.cash_usd/nav.value_usd
//          폴백 추가 (aegisLine.cash_pct null 시). 방어·차단·게이트 셀은 이미 정상.
//   [Bug2] 계층3 '했을 매매 0' — 백엔드 today_would_trade=0 은 오늘 KST 카운트로
//          사실상 옳음. 최근 20건은 어제(UTC=KST). UI 오해 방지: 라벨 "sim 체결" +
//          sub 에 "직전 7일 N건" 병기. sub head 도 '최근 sim 체결' 로 통일.
//   [UI3] 보유 sim 원장 opened_at KST 날짜별 그룹 접기 — 오늘 기본 펼침 · 이전 접힘.
//   [UI4] 홈(=보유 탭) PM 도넛 옆 hold-pm-row 에 sim 미니 라인 추가
//         (invested/return_pct/util from sim_portfolio.pm_summary).
//   [UI5] 이력 sim 체결 컴팩트 (1줄/건 · 기본 5건 · '더보기' 토글).
//   [UI6] "했을 매매" → "sim 체결" · 가정법 제거 (배지가 이미 sim 표시).
//   [UI7] 승인 달력에 approvals.history 통합 — decided_at 날짜에 상태별 점
//         (승인 초록 · 반려 빨강 · 만료 회색) + 패널에 결재 카드 (사유·metadata·라우팅 PM).
//   [UI8] 방어판 + 리스크 통계 통합 카드 + nearmiss 헤드라인 ('가장 가까운 방어선 · 여유 X%').
//         defense.lines 값이 임계에 얼마나 가까운지 계산 (VIX/MDD 등).
//   [UI9] 14일 미니바 — 소스 접근 이미 복구됨(v13.1). 데이터가 있으면 정상 렌더.
//   매매·Aegis·미러 무손. 캐시 무효화 bump.
// v13.3 (20260715) — 밀도 개선 라운드 (실화면 피드백). 표시 계층만.
//   [Data1] 보유 PM 미니 라인·도넛 5 PM 전원 표시 — registry(team_desk.desks) 순회.
//           pm_summary 미존재 PM (박세진·한도현 등) 은 "투입 $0 · 매매 대기" 명시.
//           하드코딩 금지 — 활성 PM 순회로 자동 대응.
//   [Data2] 도넛 밑 "데이터 수집 중" 제거 — sim virtual_nav 요약 카드로 대체
//           (총 투입 · 현금 · 총 손익).
//   [Data3] 도넛 조각 위 PM명+% 상시 표시 — Chart.js afterDatasetsDraw 훅으로
//           각 슬라이스 중심에 라벨 오버레이. 호버 의존 제거.
//   [UI4] 보유 sim 원장 테이블 밀도 개선 — 셀 여백 10→6, 폰트 12→11.5,
//         헤더 폰트 10→9.5. 사이드 카드 추가 (오늘 매수·매도 건수·금액,
//         최다 활동 PM). 2열 그리드 (≥1100px).
//   [UI5] 이력 타임라인 2열 그리드 — 좌: 타임라인 (밀도↑, padding 9→5) /
//         우: sim 체결. 세로 길이 절반 목표.
//   [UI6] 14일 미니바 제거 확정 — HTML·JS·CSS 정리, 타임라인이 그 위치로 상승.
//   [UI7] sim 체결 5-폭 그리드 재조정 (빈 컬럼 없게) — 시간 · 종목(PM점) ·
//         방향 · 체결($금액 + 수량 sub) · 신호. 우측 열로 이동.
//   매매·Aegis·미러 무손. 캐시 무효화 bump.
const CACHE_VERSION = 'v13.3';
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
