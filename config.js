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
    { id: 'meter',   icon: '📟', name: '설비검침',                  desc: '현장 검침값 입력 (핸드폰) · 유틸리티 분석과 자동 연결',            path: 'meter/',   ready: true },
    { id: 'insp',    icon: '📋', name: '설비점검일지',              desc: '유틸리티 일일 점검 ○Ⅹ△◎ 입력 (핸드폰) · 점검일지 출력',            path: 'insp/',    ready: true },
    { id: 'env',     icon: '🌿', name: '환경일지',                  desc: '다온산업 장부 입력 · 폐수일지 · 대기일지 출력',                     path: 'env/',     ready: true, partner: true },
    { id: 'utility', icon: '📊', name: '유틸리티 사용량·비용 분석', desc: '전기·가스·용수·폐수 월별 사용량과 금액, 목표 대비, 원단위 추이',   path: 'utility/', ready: true },
    { id: 'load',    icon: '⚡', name: '설비별 부하 모니터링',      desc: 'Shelly 전류·전력 실시간 모니터링 (P-레토르트, P-냉동1·2, P-내포장)', path: 'load/',    ready: false }
  ],
  // 홈 화면 '바로가기' (다른 사이트 — 새 창으로 열림, 협력업체 계정에는 안 보임)
  LINKS: [
    { icon: '🗂️', name: '그룹웨어 현장 작업내역', desc: 'Works (회사 그룹웨어 로그인 필요)', url: 'https://gw.bongroup.co.kr/app/works/applet/1595/home' }
  ]
};
