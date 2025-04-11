import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

export default function Result() {
  const navigate = useNavigate();
  const [hiddenResults, setHiddenResults] = useState(
    JSON.parse(localStorage.getItem("hiddenResults") || "[]")
  );
  const [publicResults, setPublicResults] = useState(
    JSON.parse(localStorage.getItem("publicResults") || "[]")
  );
  const [filter, setFilter] = useState({ hidden: "", public: "" });
  const [status, setStatus] = useState("⏳ 결과를 불러오는 중...");
  const [retryCount, setRetryCount] = useState(0);
  const [progress, setProgress] = useState(null);
  const [range, setRange] = useState({ start: null, end: null });
  const manualClose = useRef(false);
  const socketRef = useRef(null);
  const reconnectTimeout = useRef(null);
  const fetchedCsq = useRef(new Set());

  const getCsq = (row) => {
    const match = row.match(/csq=(\d+)/);
    return match ? match[1] : null;
  };

  const insertUniqueSorted = (arr, newItem, isHidden) => {
    const csq = getCsq(newItem);
    if (!csq || fetchedCsq.current.has(csq)) return arr;
    fetchedCsq.current.add(csq);
    const filtered = arr.filter((item) => getCsq(item) !== csq);
    filtered.push(newItem);
    const sorted = filtered.sort((a, b) => {
      const timeA = a.split(" & ")[4];
      const timeB = b.split(" & ")[4];
      return timeA.localeCompare(timeB);
    });
    const key = isHidden ? "hiddenResults" : "publicResults";
    localStorage.setItem(key, JSON.stringify(sorted));
    return sorted;
  };

  const downloadTxt = (data, filename) => {
    const blob = new Blob([data.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearResults = () => {
    localStorage.removeItem("hiddenResults");
    localStorage.removeItem("publicResults");
    setHiddenResults([]);
    setPublicResults([]);
    fetchedCsq.current = new Set();
    setProgress(null);
  };

  useEffect(() => {
    manualClose.current = false;

    const urlParams = new URLSearchParams(window.location.search);
    const session_cookie = urlParams.get("session_cookie");
    const selected_days = urlParams.get("selected_days");
    const exclude_keywords = urlParams.get("exclude_keywords") || "";
    const use_full_range = urlParams.get("use_full_range") === "true";
    const start_id = urlParams.get("start_id");
    const end_id = urlParams.get("end_id");
    const realtime = urlParams.get("realtime") !== "false";

    const payload = {
      session_cookie,
      selected_days,
      exclude_keywords,
      use_full_range,
      exclude_ids: Array.from(fetchedCsq.current),
    };

    if (!use_full_range && start_id && end_id) {
      payload.start_id = parseInt(start_id);
      payload.end_id = parseInt(end_id);
      setRange({ start: parseInt(start_id), end: parseInt(end_id) });
    }

    fetch(`https://gtoapp.onrender.com/api/results?session_cookie=${session_cookie}`)
      .then((res) => res.ok ? res.json() : Promise.reject("API 오류"))
      .then((data) => {
        if (data.status === "ok") {
          setStatus(realtime ? "📦 저장된 결과 불러옴, 실시간 연결 중..." : "📦 저장된 결과 불러왔습니다");
        } else {
          setStatus("❌ 저장된 결과가 없습니다");
        }

        if (realtime) {
          const socket = new WebSocket("wss://gtoapp.onrender.com/ws/crawl");
          socketRef.current = socket;

          socket.onopen = () => {
            setStatus("✅ 실시간 연결됨. 수신 중...");
            setRetryCount(0);
            socket.send(JSON.stringify(payload));
          };

          socket.onmessage = (event) => {
            if (event.data === "ping") return;
            const message = JSON.parse(event.data);
            const { event: type, data } = message;

            if (type === "hidden") {
              setHiddenResults((prev) => insertUniqueSorted(prev, data, true));
            } else if (type === "public") {
              setPublicResults((prev) => insertUniqueSorted(prev, data, false));
            } else if (type === "done") {
              setStatus("✅ 데이터 수신 완료");
              socket.close();
              downloadTxt(hiddenResults, "숨김캠페인.txt");
              downloadTxt(publicResults, "공개캠페인.txt");
            } else if (type === "error") {
              setStatus("❌ 에러 발생: " + data);
              socket.close();
            }

            const csq = getCsq(data);
            if (csq && range.start && range.end) {
              const percent = Math.floor(((parseInt(csq) - range.start) / (range.end - range.start)) * 100);
              setProgress(percent);
            }
          };

          socket.onerror = () => {
            setStatus("❌ 서버 오류. 연결 종료");
            socket.close();
          };

          socket.onclose = () => {
            if (!manualClose.current && retryCount < 5) {
              reconnectTimeout.current = setTimeout(() => {
                setRetryCount((prev) => prev + 1);
                setStatus("🔄 재연결 중...");
                window.location.reload();
              }, 2000);
            } else {
              setStatus("🔌 연결이 종료되었습니다");
            }
          };
        }
      })
      .catch((err) => setStatus("❌ API 호출 실패: " + err));

    return () => {
      manualClose.current = true;
      if (socketRef.current) socketRef.current.close();
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    };
  }, []);

  const renderTable = (data, title, isHidden) => {
    const keyword = isHidden ? filter.hidden : filter.public;
    const filtered = data.filter((row) => row.includes(keyword));
    const setData = isHidden ? setHiddenResults : setPublicResults;

    const handleDelete = (idxToDelete) => {
      setData((prev) => {
        const updated = [...prev];
        updated.splice(idxToDelete, 1);
        const key = isHidden ? "hiddenResults" : "publicResults";
        localStorage.setItem(key, JSON.stringify(updated));
        return updated;
      });
    };

    return (
      <div style={{ marginBottom: 40 }}>
        <h3>
          {title} ({filtered.length}건)
          <button
            onClick={() => downloadTxt(filtered, isHidden ? "숨김캠페인.txt" : "공개캠페인.txt")}
            style={{ marginLeft: 12, padding: "4px 10px", fontSize: 14 }}
          >📥 다운로드</button>
        </h3>
        <input
          type="text"
          placeholder="🔎 필터링할 키워드를 입력하세요"
          value={keyword}
          onChange={(e) => setFilter((prev) => ({ ...prev, [isHidden ? "hidden" : "public"]: e.target.value }))}
          style={{ marginBottom: 10, width: 300 }}
        />
        <table border="1" cellPadding="6" style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th>삭제</th>
              <th>구분</th>
              <th>리뷰</th>
              <th>쇼핑몰</th>
              <th>가격</th>
              <th>시간</th>
              <th>상품명</th>
              <th>링크</th>
              <th>번호</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, idx) => {
              const [type, review, mall, price, time, name, url] = row.split(" & ");
              const csq = getCsq(url) || "-";
              const realIndex = data.findIndex((item) => item === row);
              return (
                <tr key={csq + "_" + idx}>
                  <td><button onClick={() => handleDelete(realIndex)} style={{ backgroundColor: "red", color: "white" }}>삭제</button></td>
                  <td>{type}</td>
                  <td>{review}</td>
                  <td>{mall}</td>
                  <td>{Number(price.replace(/[^\d]/g, "")).toLocaleString("ko-KR")}</td>
                  <td>{time}</td>
                  <td>{name}</td>
                  <td><a href={url} target="_blank" rel="noreferrer">바로가기</a></td>
                  <td>{csq}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>📡 실시간 크롤링 결과</h2>
      <p style={{ color: "green" }}>{status} {progress !== null && `(${progress}%)`}</p>
      <button onClick={() => navigate("/")}>🔙 처음으로</button>
      <button onClick={clearResults} style={{ marginLeft: 10, color: "red" }}>🗑 Clear</button>
      {socketRef.current && (
        <button
          style={{ marginLeft: 10, backgroundColor: "#ddd" }}
          onClick={() => {
            manualClose.current = true;
            socketRef.current.close();
            socketRef.current = null;
            setStatus("🔌 연결 강제 종료됨");
          }}
        >
          🔌 연결 강제 종료
        </button>
      )}
      <br /><br />
      {renderTable(hiddenResults, "🔒 숨겨진 캠페인", true)}
      {renderTable(publicResults, "🌐 공개 캠페인", false)}
    </div>
  );
}
