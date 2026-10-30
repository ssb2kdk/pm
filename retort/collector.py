#!/usr/bin/env python3
# =====================================================================
# 레토르트 온도기록계(CHINO KR2S) → Supabase 수집 프로그램
#  - 장비망(192.168.254.x)에 연결된 PC(리눅스 서버 또는 윈도우)에서 계속 실행
#  - 기록계에 Modbus-TCP(포트 502)로 "지금 값"을 물어보고, Supabase(40번 SQL)의 retort_ingest 로 보냄
#  - 기록계 값은 읽기만 함 (설정을 바꾸는 명령은 보내지 않음)
#  - 파이썬 3.8 이상, 따로 설치할 패키지 없음
#
# 실행:  python3 collector.py          (윈도우: py collector.py)
# 시험:  python3 collector.py --test   (기록계 값만 한 번 읽어서 보여주고 끝냄, Supabase 로는 안 보냄)
#
# 리눅스 서버에서 켜질 때마다 자동 실행 (systemd):
#   1) 이 파일을 /opt/retort/collector.py 에 두고 아래 SECRET 을 채움
#   2) /etc/systemd/system/retort-collector.service 파일을 아래 내용으로 만듦
#        [Unit]
#        Description=Retort recorder collector
#        After=network-online.target
#        [Service]
#        ExecStart=/usr/bin/python3 /opt/retort/collector.py
#        Restart=always
#        RestartSec=10
#        [Install]
#        WantedBy=multi-user.target
#   3) sudo systemctl enable --now retort-collector
#   4) 상태 보기: journalctl -u retort-collector -f
# =====================================================================
import json
import socket
import sys
import time
import urllib.request
from datetime import datetime, timezone

# ---------------- 설정 (여기만 고치면 됨) ----------------
SUPABASE_URL = "https://ncboxlsbbfhrupapipov.supabase.co"
APIKEY = "sb_publishable_mYUd7LbTsbvg5lvAohRiTw_KL0T0eKD"
SECRET = "여기에_비밀번호"   # 25번 SQL(쉘리)에 넣은 것과 같은 문자

# 레토르트 목록: id 는 40번 SQL 의 retort_units 와 같아야 함
UNITS = [
    {"id": "retort_2", "ip": "192.168.254.1"},
]

POLL_SEC = 10        # 기록계에 물어보는 간격 (초)
IDLE_SEC = 60        # 쉬는 중에는 이 간격으로만 저장 (DB 용량 아끼기)
RUN_TEMP = 40.0      # 챔버 온도가 이 이상이거나
RUN_PRESS = 0.05     # 챔버 압력이 이 이상이면 "운전 중" → POLL_SEC 마다 저장
MAX_BUFFER = 30000   # 인터넷이 끊겼을 때 모아두는 최대 건수 (레토르트별, 10초 간격이면 약 3일)

# 기록계 채널 순서 (웹 「데이터 표시」의 채널 번호 1~10)
#  CH1 챔버 온도, CH2 챔버 압력, CH3~6 TEMP_1~4, CH7~10 Fo_1~4
# 채널마다 레지스터 2칸: [값, 소수점 자리수] — 30101 부터 (Modbus 주소 100)
START_ADDR = 100
CHANNELS = 10
# ---------------------------------------------------------


def log(msg):
    print(datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        part = sock.recv(n - len(buf))
        if not part:
            raise ConnectionError("기록계가 연결을 끊음")
        buf += part
    return buf


_tid = 0


def read_input_registers(ip, start, count, timeout=3):
    """Modbus-TCP 기능 04 (입력 레지스터 읽기). 부호 있는 16비트 값 목록을 돌려줌."""
    global _tid
    _tid = (_tid + 1) % 65536
    req = bytes([_tid >> 8, _tid & 255, 0, 0, 0, 6, 1, 4, start >> 8, start & 255, count >> 8, count & 255])
    with socket.create_connection((ip, 502), timeout=timeout) as s:
        s.settimeout(timeout)
        s.sendall(req)
        head = recv_exact(s, 9)
        if head[7] & 0x80:
            raise IOError(f"기록계 오류 코드 {head[8]}")
        data = recv_exact(s, head[8])
    vals = []
    for i in range(0, len(data), 2):
        v = data[i] * 256 + data[i + 1]
        vals.append(v - 65536 if v > 32767 else v)
    return vals


def read_unit(ip):
    regs = read_input_registers(ip, START_ADDR, CHANNELS * 2)
    out = []
    for ch in range(CHANNELS):
        raw, dp = regs[ch * 2], regs[ch * 2 + 1]
        out.append(round(raw / (10 ** dp), dp) if 0 <= dp <= 5 else None)
    return out


def post_rows(unit_id, rows):
    body = json.dumps({"p_secret": SECRET, "p_unit": unit_id, "p_rows": rows}).encode()
    req = urllib.request.Request(
        SUPABASE_URL + "/rest/v1/rpc/retort_ingest", data=body, method="POST",
        headers={"Content-Type": "application/json", "apikey": APIKEY, "Authorization": "Bearer " + APIKEY})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def main():
    if "--test" in sys.argv:
        names = ["챔버 온도", "챔버 압력", "TEMP_1", "TEMP_2", "TEMP_3", "TEMP_4", "Fo_1", "Fo_2", "Fo_3", "Fo_4"]
        for u in UNITS:
            v = read_unit(u["ip"])
            print(u["id"], u["ip"])
            for n, x in zip(names, v):
                print(f"  {n:8} {x}")
        return

    if SECRET == "여기에_비밀번호":
        log("SECRET 을 25번 SQL 에 넣은 비밀문자로 바꿔 주세요.")
        sys.exit(1)

    buf = {u["id"]: [] for u in UNITS}
    last_kept = {u["id"]: 0.0 for u in UNITS}
    down = {u["id"]: False for u in UNITS}
    send_fail = False
    log(f"시작: 레토르트 {len(UNITS)}대, {POLL_SEC}초마다 읽기")

    while True:
        t0 = time.time()
        for u in UNITS:
            uid = u["id"]
            try:
                v = read_unit(u["ip"])
                if down[uid]:
                    log(f"{uid} 다시 연결됨")
                    down[uid] = False
            except Exception as e:
                if not down[uid]:
                    log(f"{uid} ({u['ip']}) 읽기 실패: {e}")
                    down[uid] = True
                continue
            running = (v[0] is not None and v[0] >= RUN_TEMP) or (v[1] is not None and v[1] >= RUN_PRESS)
            if running or t0 - last_kept[uid] >= IDLE_SEC:
                ts = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
                buf[uid].append({"t": ts, "v": v})
                del buf[uid][:-MAX_BUFFER]
                last_kept[uid] = t0

        for uid, rows in buf.items():
            while rows:
                chunk = rows[:500]
                try:
                    post_rows(uid, chunk)
                except Exception as e:
                    if not send_fail:
                        log(f"Supabase 보내기 실패 (모아뒀다가 다시 보냄): {e}")
                        send_fail = True
                    break
                del rows[:len(chunk)]
                if send_fail:
                    log("Supabase 보내기 다시 됨")
                    send_fail = False

        time.sleep(max(1.0, POLL_SEC - (time.time() - t0)))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
