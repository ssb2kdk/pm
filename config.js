// =====================================================================
// 순수본 2공장 시설팀 웹페이지 — 공통 설정 (이 파일 하나만 고치면 모든 앱에 적용)
// =====================================================================
// SUPABASE_KEY: Supabase → Project Settings → API Keys 의 "Publishable key" (sb_publishable_...)
// ※ secret key(sb_secret_...)는 절대 넣으면 안 됩니다.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://ncboxlsbbfhrupapipov.supabase.co',
  SUPABASE_KEY: 'sb_publishable_mYUd7LbTsbvg5lvAohRiTw_KL0T0eKD',
  EMAIL_DOMAIN: 'ssb2.local',   // 사용자 관리 함수(admin-users)와 같아야 함
  PLANT_NAME: '순수본 2공장',
  TEAM_NAME: '시설팀',

  // 홈 화면에 보이는 앱 목록. 새 앱이 생기면 여기에 한 줄 추가하고 ready를 true로.
  APPS: [
    { id: 'pm',      icon: '🔧', name: '예방정비 점검일정관리',     desc: '연간·월간·주간·일일 점검/정비 일정, 완료 기록, 월간 점검표 출력', path: 'pm/',      ready: true },
    { id: 'utility', icon: '📊', name: '유틸리티 사용량·비용 분석', desc: '전기·가스·용수·폐수 월별 사용량과 금액, 목표 대비, 원단위 추이',   path: 'utility/', ready: false },
    { id: 'inspect', icon: '📋', name: '설비점검일지',             desc: '생산설비 일일 점검 O/X 기록',                                     path: 'inspect/', ready: false },
    { id: 'load',    icon: '⚡', name: '설비별 부하 모니터링',      desc: 'Shelly 전류·전력 실시간 모니터링 (P-레토르트, P-냉동1·2, P-내포장)', path: 'load/',    ready: false }
  ]
};
