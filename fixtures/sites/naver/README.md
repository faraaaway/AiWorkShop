# 네이버쇼핑 — 차단 확인 후 중단 (2026-11-27 조사)

T043은 구현하지 않았다. 3-crawl-a.md의 "봇 차단이 강하면 확인까지만 하고 중단"에 해당한다.
Obscura 0.2.7로 요청 3번만 보내고 멈췄다. 블프 행사 페이지 주소는 확인하지 못했다.

| 요청 | 결과 |
|------|------|
| `https://shopping.naver.com/robots.txt` | 마지막 그룹이 `User-agent: *` → `Disallow: /` ("기타 모든 크롤러 차단") |
| `obscura --obey-robots fetch https://shopping.naver.com/ns/home` | `Blocked by robots.txt` |
| `https://search.shopping.naver.com/robots.txt` | robots.txt 대신 접속 제한 안내 페이지: "쇼핑 서비스 접속이 일시적으로 제한되었습니다 … 비정상적인 접근이 감지될 경우 해당 네트워크의 접속을 일시적으로 제한" |

- 두 번째 호스트의 응답에는 research.md R4의 차단 신호("비정상적인 접근")가 들어 있다. 헌법 II에 따라 재시도하지 않는다.
- `obeyRobots: false`로 바꿔도 해결되지 않는다. 막는 것이 robots.txt만이 아니라 접속 제한(봇 감지)이기 때문이다.
  같은 네트워크에서 요청을 더 보내면 제한이 길어질 수 있어 추가 요청을 하지 않았다. 스텁(`disabled`)으로 둔다.
