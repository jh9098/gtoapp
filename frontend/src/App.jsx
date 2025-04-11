import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function App() {
  const [cookie, setCookie] = useState("");
  const [selectedDays, setSelectedDays] = useState([]);
  const [exclude, setExclude] = useState("");
  const [loading, setLoading] = useState(false);
  const [useFullRange, setUseFullRange] = useState(true);
  const [startId, setStartId] = useState(19500);
  const [endId, setEndId] = useState(22000);

  const navigate = useNavigate();
  const days = Array.from({ length: 31 }, (_, i) => `${String(i + 1).padStart(2, "0")}일`);

  useEffect(() => {
    const savedCookie = localStorage.getItem("last_cookie");
    const savedDays = JSON.parse(localStorage.getItem("last_days") || "[]");
    const savedExclude = localStorage.getItem("last_exclude");
    const savedUseFullRange = localStorage.getItem("last_use_full_range") === "true";

    if (savedCookie) setCookie(savedCookie);
    if (savedDays.length > 0) setSelectedDays(savedDays);
    if (savedExclude) setExclude(savedExclude);
    setUseFullRange(savedUseFullRange);
  }, []);

  const toggleDay = (day) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSubmit = () => {
    const manualStartId = Number(document.querySelector("#startId")?.value || "0");
    const manualEndId = Number(document.querySelector("#endId")?.value || "0");

    if (!cookie) {
      alert("PHPSESSID를 입력해주세요.");
      return;
    }

    if (selectedDays.length === 0) {
      alert("참여 날짜를 하나 이상 선택해주세요.");
      return;
    }

    if (!useFullRange && manualStartId >= manualEndId) {
      alert("시작 ID가 끝 ID보다 작아야 합니다.");
      return;
    }

    setLoading(true);

    localStorage.setItem("last_cookie", cookie);
    localStorage.setItem("last_days", JSON.stringify(selectedDays));
    localStorage.setItem("last_exclude", exclude);
    localStorage.setItem("last_use_full_range", String(useFullRange));
    if (!useFullRange) {
      localStorage.setItem("last_start_id", String(manualStartId));
      localStorage.setItem("last_end_id", String(manualEndId));
    }

    const query = new URLSearchParams({
      session_cookie: cookie,
      selected_days: selectedDays.join(","),
      exclude_keywords: exclude,
      use_full_range: useFullRange.toString(),
    });

    if (!useFullRange) {
      query.append("start_id", manualStartId.toString());
      query.append("end_id", manualEndId.toString());
    }

    // 페이지 완전 새로고침
    window.location.href = `/result?${query.toString()}`;
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>📦 캠페인 필터링</h2>

      <label>PHPSESSID:</label>
      <br />
      <input
        value={cookie}
        onChange={(e) => setCookie(e.target.value)}
        style={{ width: 300 }}
      />
      <br /><br />

      <label>참여 날짜 선택 (다중 가능):</label>
      <br />
      <div style={{ display: "flex", flexWrap: "wrap", maxWidth: 500 }}>
        {days.map((d) => (
          <button
            key={d}
            onClick={() => toggleDay(d)}
            style={{
              margin: 4,
              background: selectedDays.includes(d) ? "#0077ff" : "#ddd",
              color: selectedDays.includes(d) ? "#fff" : "#000",
              borderRadius: 4,
              padding: "4px 8px",
              cursor: "pointer",
            }}
          >
            {d}
          </button>
        ))}
      </div>
      <br />

      <label>제외 키워드 (쉼표로 구분):</label>
      <br />
      <input
        value={exclude}
        onChange={(e) => setExclude(e.target.value)}
        style={{ width: 300 }}
        placeholder="이발기, 강아지, 깔창 등"
      />
      <br /><br />

      <label>캠페인 ID 범위 선택:</label>
      <br />
      <label>
        <input
          type="radio"
          checked={useFullRange}
          onChange={() => setUseFullRange(true)}
        />
        전체 범위 자동 탐색
      </label>
      <br />
      <label>
        <input
          type="radio"
          checked={!useFullRange}
          onChange={() => setUseFullRange(false)}
        />
        수동 범위 입력
      </label>
      <br /><br />

      {!useFullRange && (
        <>
          <label>시작 캠페인 ID:</label>
          <br />
          <input
            id="startId"
            type="number"
            value={startId}
            onChange={(e) => setStartId(Number(e.target.value))}
          />
          <br /><br />
          <label>끝 캠페인 ID:</label>
          <br />
          <input
            id="endId"
            type="number"
            value={endId}
            onChange={(e) => setEndId(Number(e.target.value))}
          />
          <br /><br />
        </>
      )}

      <button onClick={handleSubmit} disabled={loading}>
        {loading ? "⏳ 실행 중..." : "✅ 실시간 실행"}
      </button>
      <button
        style={{ marginLeft: 10, backgroundColor: "#eee", padding: "4px 10px" }}
        onClick={() => {
          localStorage.removeItem("hiddenResults");
          localStorage.removeItem("publicResults");
          alert("🔌 연결 상태 초기화됨. 결과보기에 이전 데이터가 남아 있지 않습니다.");
        }}
      >
        🔌 Render 연결 초기화
      </button>

      <button
        style={{ marginLeft: 10 }}
        onClick={() => {
          const query = new URLSearchParams({
            session_cookie: cookie,
            selected_days: selectedDays.join(","),
            exclude_keywords: exclude,
            use_full_range: useFullRange.toString(),
          });
      
          if (!useFullRange) {
            query.append("start_id", startId.toString());
            query.append("end_id", endId.toString());
          }
      
          window.location.href = `/result?${query.toString()}`;
        }}
      >
        📄 업로드 결과 보기
      </button>
    </div>
  );
}
