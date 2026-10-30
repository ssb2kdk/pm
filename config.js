// =====================================================================
// 순수본 2공장 시설관리시스템 — 공통 설정 (이 파일 하나만 고치면 모든 앱에 적용)
// =====================================================================
// SUPABASE_KEY: Supabase → Project Settings → API Keys 의 "Publishable key" (sb_publishable_...)
// ※ secret key(sb_secret_...)는 절대 넣으면 안 됩니다.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://ncboxlsbbfhrupapipov.supabase.co',
  SUPABASE_KEY: 'sb_publishable_mYUd7LbTsbvg5lvAohRiTw_KL0T0eKD',
  EMAIL_DOMAIN: 'ssb2.local',   // 사용자 관리 함수(admin-users)와 같아야 함
  PLANT_NAME: '순수본 2공장',
  TEAM_NAME: '운영팀',          // 보고서 작성 부서
  SYSTEM_NAME: '순수본 2공장 시설관리시스템',   // 화면 왼쪽 위·로그인 화면·브라우저 탭에 나오는 이름

  // 홈 화면에 보이는 앱 목록. 새 앱이 생기면 여기에 한 줄 추가하고 ready를 true로.
  APPS: [
    { id: 'pm',      icon: '🔧', name: '예방정비 점검일정관리',     desc: '연간·월간·주간·일일 점검/정비 일정, 완료 기록, 월간 점검표 출력', path: 'pm/',      ready: true },
    { id: 'meter',   icon: '📟', name: '설비검침',                  desc: '현장 검침값 입력 + 설비점검일지 ○Ⅹ△◎ (핸드폰) · 점검일지 출력 · 유틸리티 분석과 자동 연결',            path: 'meter/',   ready: true, noViewer: true },
    { id: 'insp',    icon: '📋', name: '설비점검일지',              desc: '유틸리티 일일 점검 ○Ⅹ△◎ 입력 (핸드폰) · 점검일지 출력',            path: 'insp/',    ready: true, hidden: true /* 설비검침에 합침 — 출력·항목 관리는 설비검침 「🖨 점검일지」 버튼 */ },
    { id: 'env',     icon: '🌿', name: '환경일지',                  desc: '다온산업 장부 입력 · 폐수일지 · 대기일지 출력',                     path: 'env/',     ready: true, partner: true },
    { id: 'mat',     icon: '📦', name: '자재·스페어 관리',          desc: '주요 설비 스페어 재고(입출고·안전 재고·QR) + 소모품 발주 요청', path: 'spare/',     ready: true, noViewer: true },
    { id: 'log',     icon: '📌', name: '현장 요청사항',             desc: '현장에서 생긴 요청을 올리고 담당자 지정 · 완료 예정일 · 시설팀 모두가 같이 봄', path: 'log/',     ready: true, noViewer: true },
    { id: 'load',    icon: '⚡', name: '설비별 부하 모니터링',      desc: 'Shelly 전류·전력 실시간 모니터링 (P-레토르트, P-냉동1·2, P-내포장)', path: 'load/',    ready: true },
    { id: 'retort',  icon: '♨️', name: '레토르트 모니터링',         desc: '온도기록계 실시간 값 (챔버 온도·압력, TEMP_1~4, Fo) · 기간 그래프', path: 'retort/',  ready: true },
    { id: 'utility', icon: '📊', name: '유틸리티 분석',             desc: '전기·가스·용수·폐수 현황 · 지표 분석 · 원인 찾기 · 목표·예산 · 월간보고서',   path: 'utility/', ready: true },
    { id: 'bill',    icon: '🧾', name: '유틸리티 마감',             desc: '고지서 입력·확정 · 회계보고 · 지출결의 자료 (시설팀 누구나)',  path: 'utility/?bill', ready: true },
    { id: 'elec',    icon: '⚡', name: '전기 직무고시',             desc: '연간 점검 계획표 · 월차 점검 · 저압 절연저항·접지저항 · 고압 설비 · 변압기 · 후크메타 부하 측정', path: 'elec/',    ready: true, noViewer: true },
    { id: 'audit',   icon: '🕘', name: '변경 기록',                 desc: '누가·언제·무엇을 바꿨는지 (바뀌기 전 값 포함) — 관리자만', path: 'audit/',   ready: true, admin: true }
  ],
  // 홈 화면 '바로가기' (다른 사이트 — 새 창으로 열림, 협력업체 계정에는 안 보임)
  LINKS: [
    { icon: '🗂️', name: '그룹웨어 현장 작업내역', desc: 'Works (회사 그룹웨어 로그인 필요)', url: 'https://gw.bongroup.co.kr/app/works/applet/1595/home' },
    { icon: '📇', name: '그룹웨어 설비이력카드', desc: 'Works (회사 그룹웨어 로그인 필요)', url: 'https://gw.bongroup.co.kr/app/works/applet/1584/home' },
    { icon: '🔍', name: '이물관리', desc: '순수본 2공장 이물 클레임 관리 (별도 사이트)', url: 'https://appieboysoni.github.io/ssbon-claim-defense/' },
    { icon: '🏭', name: '순수본 2공장 스마트팩토리', desc: '생산 관리 (별도 사이트)', url: 'https://wooms19-del.github.io/ssbon-2factory/' },
    { icon: '✅', name: '순수본 HACCP 스마트팩토리', desc: 'HACCP 관리 (별도 사이트)', url: 'https://ssbon.haccp-app.workers.dev/' }
  ]
};
