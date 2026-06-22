const http = require("http");
const url = require("url");
const { createClient } = require("@supabase/supabase-js");

// =====================
// Supabase
// =====================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =====================
// 시간 기준 (07:52 컷오프)
// =====================
function getGameDay(date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);

  let y = kst.getUTCFullYear();
  let m = kst.getUTCMonth();
  let d = kst.getUTCDate();

  const h = kst.getUTCHours();
  const min = kst.getUTCMinutes();

  if (h < 7 || (h === 7 && min < 52)) {
    const prev = new Date(Date.UTC(y, m, d - 1));
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth();
    d = prev.getUTCDate();
  }

  return {
    date: `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    month: `${y}-${String(m + 1).padStart(2, "0")}`,
    year: `${y}`
  };
}

// =====================
// 이름 정리
// =====================
function cleanName(name) {
  return (name || "").toString().trim().toLowerCase();
}

// =====================
// streak 계산
// =====================
function calcStreak(dates) {
  if (!dates.length) return 0;

  const sorted = [...dates].sort().reverse();

  let streak = 1;

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = new Date(sorted[i]);
    const prev = new Date(sorted[i + 1]);

    const diff = (cur - prev) / (1000 * 60 * 60 * 24);

    if (diff === 1) streak++;
    else break;
  }

  return streak;
}

// =====================
// 서버
// =====================
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  const user = cleanName(parsed.query.user);

  const now = new Date();
  const game = getGameDay(now);

  const today = game.date;
  const thisMonth = game.month;
  const thisYear = game.year;

  const monthNumber = Number(thisMonth.split("-")[1]);

  // ==================================================
  // 1️⃣ 출석
  // ==================================================
  if (path === "/attend") {
    if (!user) return res.end("유저 없음");

    // streak 계산용 기존 데이터
    const { data: all } = await supabase
      .from("attendance")
      .select("date")
      .eq("username", user);

    const dates = all?.map(v => v.date) ?? [];
    const streak = calcStreak([...dates, today]);

    // insert (DB에서 중복 차단됨)
    const { error } = await supabase
      .from("attendance")
      .insert([
        {
          username: user,
          date: today,
          month: thisMonth,
          year: thisYear,
          time: Date.now(),
          streak
        }
      ]);
console.log("INSERT ERROR:", error);

    // 🔥 중복 출석 처리
    if (error) {
      if (error.code === "23505") {
        const { count } = await supabase
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .eq("username", user)
          .eq("month", thisMonth);

        return res.end(
          `🌸${user}🌸 오늘 이미 출석 완료 (${monthNumber}월 ${count || 0}회)`
        );
      }

      console.log(error);
      return res.end("출석 저장 실패");
    }

    // 월 카운트
    const { count } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("username", user)
      .eq("month", thisMonth);

    const time = now.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });

    const streakText = streak >= 2 ? `🔥${streak}일 연속 ` : "";

    return res.end(
      `🌸${user}🌸 ${time} ${streakText}출첵완료 (${monthNumber}월 ${count || 0}회)`
    );
  }

  // ==================================================
  // 2️⃣ 체크
  // ==================================================
  if (path === "/check") {
    const { data: monthData } = await supabase
      .from("attendance")
      .select("username")
      .eq("month", thisMonth);

    const { data: yearData } = await supabase
      .from("attendance")
      .select("username")
      .eq("year", thisYear);

    const makeRank = (data) => {
      const count = {};
      (data ?? []).forEach(d => {
        count[d.username] = (count[d.username] || 0) + 1;
      });
      return Object.entries(count).sort((a, b) => b[1] - a[1]);
    };

    const monthRank = makeRank(monthData);
    const yearRank = makeRank(yearData);

    const monthCount = monthRank.find(v => v[0] === user)?.[1] || 0;
    const yearCount = yearRank.find(v => v[0] === user)?.[1] || 0;

    const monthRankPos = monthRank.findIndex(v => v[0] === user) + 1;
    const yearRankPos = yearRank.findIndex(v => v[0] === user) + 1;

    return res.end(
      `🌸${user}🌸 ${thisMonth} ${monthCount}회(${monthRankPos}등), ${thisYear.slice(2)}년 ${yearCount}회(${yearRankPos}등)`
    );
  }

  // ==================================================
  // 3️⃣ 월랭킹
  // ==================================================
  if (path === "/rank") {
    const { data } = await supabase
      .from("attendance")
      .select("username")
      .eq("month", thisMonth);

    const count = {};
    (data ?? []).forEach(d => {
      count[d.username] = (count[d.username] || 0) + 1;
    });

    const top = Object.entries(count)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const medals = ["🥇", "🥈", "🥉"];

    return res.end(
      `🏆${thisMonth} TOP3：` +
      top.map((v, i) => `${medals[i]}${v[0]}(${v[1]}회)`).join("、")
    );
  }

  // ==================================================
  // 4️⃣ 연간랭킹
  // ==================================================
  if (path === "/legend") {
    const { data } = await supabase
      .from("attendance")
      .select("username")
      .eq("year", thisYear);

    const count = {};
    (data ?? []).forEach(d => {
      count[d.username] = (count[d.username] || 0) + 1;
    });

    const top = Object.entries(count)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const medals = ["🥇", "🥈", "🥉"];

    return res.end(
      `👑${thisYear.slice(2)} TOP3：` +
      top.map((v, i) => `${medals[i]}${v[0]}(${v[1]}회)`).join("、")
    );
  }

  res.end("OK");
});

// =====================
// 서버 실행
// =====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("server running on " + PORT);
});