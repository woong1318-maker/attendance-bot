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
// KST 시간
// =====================
function getKSTNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

// =====================
// 게임 날짜 (07:52 기준 리셋)
// =====================
function getGameDay() {
  const kst = getKSTNow();

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
// 서버
// =====================
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  const user = (parsed.query.user || "").trim().toLowerCase();

  const game = getGameDay();

  const today = game.date;
  const thisMonth = game.month;
  const thisYear = game.year;

  const monthNumber = Number(thisMonth.split("-")[1]);

  // =====================
  // 1️⃣ 출석
  // =====================
if (path === "/attend") {
if (!user) return res.end("유저 없음");

// 오늘 출석 여부
const { data: already } = await supabase
.from("attendance")
.select("id")
.eq("username", user)
.eq("date", today);

// =====================
// 이미 출석한 경우
// =====================
if (already && already.length > 0) {

const { count } = await supabase
  .from("attendance")
  .select("*", { count: "exact", head: true })
  .eq("username", user)
  .eq("month", thisMonth);

const now = getKSTNow();
let hour = now.getUTCHours();
let min = now.getUTCMinutes();

const ampm = hour >= 12 ? "PM" : "AM";
const hour12 = hour % 12 || 12;

const timeStr =
  `${String(hour12).padStart(2, "0")}:` +
  `${String(min).padStart(2, "0")}${ampm}`;

const getYesterday = (dateStr) => {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const { data: allLogs } = await supabase
  .from("attendance")
  .select("date")
  .eq("username", user);

const dateSet = new Set((allLogs ?? []).map(v => v.date));

let streak = 1;
let checkDate = today;

while (true) {
  const prev = getYesterday(checkDate);

  if (dateSet.has(prev)) {
    streak++;
    checkDate = prev;
  } else {
    break;
  }
}

const message =
  streak >= 2
    ? `🌸${user}🌸 [${timeStr} 🔥${streak}일 연속출첵완료 재확인, ${monthNumber}월 ${count || 0}회]🙋🏻‍♀️오늘 하루도 힘내요!`
    : `🌸${user}🌸 [${timeStr} 출첵완료 재확인, ${monthNumber}월 ${count || 0}회]🙋🏻‍♀️오늘 하루도 힘내요!`;

return res.end(message);

}

// =====================
// 새 출석 저장
// =====================
await supabase.from("attendance").insert([
{
username: user,
date: today,
month: thisMonth,
year: thisYear,
time: Date.now()
}
]);

// 월 출석 수
const { count } = await supabase
.from("attendance")
.select("*", { count: "exact", head: true })
.eq("username", user)
.eq("month", thisMonth);

// 시간 포맷
const now = getKSTNow();
let hour = now.getUTCHours();
let min = now.getUTCMinutes();

const ampm = hour >= 12 ? "PM" : "AM";
const hour12 = hour % 12 || 12;

const timeStr =
`${String(hour12).padStart(2, "0")}:` +
`${String(min).padStart(2, "0")}${ampm}`;

// 연속출석 계산
const getYesterday = (dateStr) => {
const d = new Date(dateStr);
d.setUTCDate(d.getUTCDate() - 1);
return d.toISOString().slice(0, 10);
};

const { data: allLogs } = await supabase
.from("attendance")
.select("date")
.eq("username", user);

const dateSet = new Set((allLogs ?? []).map(v => v.date));

let streak = 1;
let checkDate = today;

while (true) {
const prev = getYesterday(checkDate);


if (dateSet.has(prev)) {
  streak++;
  checkDate = prev;
} else {
  break;
}


}

let streakMsg = "";

if (streak >= 2) {
streakMsg = ` 🔥${streak}일 연속출첵완료`;
}

const message =
streak >= 2
? `🌸${user}🌸 [${timeStr}${streakMsg}, ${monthNumber}월 ${count || 0}회]🙋🏻‍♀️오늘 하루도 힘내요!`
: `🌸${user}🌸 [${timeStr} 출첵완료, ${monthNumber}월 ${count || 0}회]🙋🏻‍♀️오늘 하루도 힘내요!`;

return res.end(message);
}


  // =====================
  // 2️⃣ 개인 체크
  // =====================
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
      `🌸${user}🌸 ${monthNumber}월 ${monthCount}회(${monthRankPos}등), 올해 ${yearCount}회(${yearRankPos}등)`
    );
  }

  // =====================
  // 3️⃣ 월 랭킹
  // =====================
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
      `${monthNumber}월 랭킹 TOP3：` +
      top.map((v, i) => `${medals[i]}${v[0]}(${v[1]}회)`).join(", ")
    );
  }

  // =====================
  // 4️⃣ 연간 랭킹
  // =====================
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
      `${thisYear.slice(2)}년 랭킹 TOP3：` +
      top.map((v, i) => `${medals[i]}${v[0]}(${v[1]}회)`).join(", ")
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