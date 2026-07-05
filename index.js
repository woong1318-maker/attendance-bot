const http = require("http");
const url = require("url");
const { createClient } = require("@supabase/supabase-js");

// =====================
// Supabase 설정
// =====================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =====================
// KST 시간 계산
// =====================
function getKSTNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

// =====================
// 게임 날짜 기준 (07:52 리셋)
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
// 영문 월 이름 변환기
// =====================
function getEnglishMonthName(monthNumber) {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  return months[monthNumber - 1] || "";
}

// =====================
// 서버 구동
// =====================
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  const user = (parsed.query.user || "").trim().toLowerCase();
  const lang = (parsed.query.lang || "ko").toLowerCase();
  const game = getGameDay();

  const today = game.date;
  const thisMonth = game.month;
  const thisYear = game.year;

  // =====================
  // 1️⃣ 출석 (/attend)
  // =====================
  if (path === "/attend") {
    if (!user) return res.end("유저 없음");

    const { data: already } = await supabase
      .from("attendance")
      .select("id")
      .eq("username", user)
      .eq("date", today);

    if (already && already.length > 0) {
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

      let message;
      if (lang === "en") {
        message =
          streak >= 2
            ? `🌸${user}🌸 [🔥${streak}-day streak confirmed]🐾Keep it up!`
            : `🌸${user}🌸 [Already checked in]🐾Have a great day!`;
      } else {
        message =
          streak >= 2
            ? `🌸${user}🌸 [🔥${streak}일 연속출석완료 재확인]🐾오늘 하루도 힘내요!`
            : `🌸${user}🌸 [출석완료 재확인]🐾오늘 하루도 힘내요!`;
      }

      return res.end(message);
    }

    await supabase.from("attendance").insert([
      {
        username: user,
        date: today,
        month: thisMonth,
        year: thisYear,
        time: Date.now()
      }
    ]);

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

    let message;
    if (lang === "en") {
      message =
        streak >= 2
          ? `🌸${user}🌸 [${timeStr} 🔥${streak}-day streak]🐾Keep it up!`
          : `🌸${user}🌸 [${timeStr} Checked in successfully]🐾Have a great day!`;
    } else {
      let streakMsg = "";
      if (streak >= 2) {
        streakMsg = ` 🔥${streak}일 연속출석완료`;
      }

      message =
        streak >= 2
          ? `🌸${user}🌸 [${timeStr}${streakMsg}]🐾오늘 하루도 힘내요!`
          : `🌸${user}🌸 [${timeStr} 출석완료]🐾오늘 하루도 힘내요!`;
    }

    return res.end(message);
  }

  // =====================
  // 2️⃣ 개인 체크 (/check) [7일 연속출석 미션 성공 표시]
  // =====================
  if (path === "/check") {
    if (!user) return res.end("유저 없음");

    const monthNumber = Number(thisMonth.split("-")[1]);

    const { count: monthCount } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("username", user)
      .eq("month", thisMonth);

    const { count: yearCount } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("username", user)
      .eq("year", thisYear);

    const { data: allLogs } = await supabase
      .from("attendance")
      .select("date")
      .eq("username", user)
      .eq("year", thisYear);
    
    const sortedDates = [...new Set((allLogs ?? []).map(v => v.date))]
      .map(d => new Date(d))
      .sort((a, b) => a - b);
    
    let bestStreak = 0;
    let tempStreak = 0;
    for (let i = 0; i < sortedDates.length; i++) {
      if (i > 0 && (sortedDates[i].getTime() - sortedDates[i - 1].getTime()) === 86400000) {
        tempStreak++;
      } else {
        tempStreak = 1;
      }
      bestStreak = Math.max(bestStreak, tempStreak);
    }
    const missionCount = Math.floor(bestStreak / 7);

    if (lang === "en") {
      const engMonth = getEnglishMonthName(monthNumber);
      return res.end(
        `🌸${user}🌸 ${monthCount || 0} times in ${engMonth}, ${yearCount || 0} times in ${thisYear}(Weekly streak: ${missionCount})`
      );
    } else {
      const shortYear = thisYear.slice(2);
      return res.end(
        `🌸${user}🌸 ${monthNumber}월 ${monthCount || 0}회, ${shortYear}년 ${yearCount || 0}회(🔥일주일 연속출석 성공 ${missionCount}회)`
      );
    }
  }

  // =====================
  // 3️⃣ 월 랭킹 (/rank)
  // =====================
  if (path === "/rank") {
    const monthNumber = Number(thisMonth.split("-")[1]);
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
  // 4️⃣ 연간 랭킹 (/legend)
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

// =====================
  // 5️⃣ 개인 등수 확인 (/rankcheck)
  // =====================
  if (path === "/rankcheck") {
    if (!user) return res.end("유저 없음");

    // 1. 해당 월 및 해당 연도 데이터 가져오기
    const { data: monthData } = await supabase
      .from("attendance")
      .select("username")
      .eq("month", thisMonth);

    const { data: yearData } = await supabase
      .from("attendance")
      .select("username")
      .eq("year", thisYear);

    // 2. 유저별 횟수 카운트
    const count = (data) => {
      const c = {};
      (data ?? []).forEach(d => { c[d.username] = (c[d.username] || 0) + 1; });
      return c;
    };

    const monthCounts = count(monthData);
    const yearCounts = count(yearData);

    const uMonth = monthCounts[user] || 0;
    const uYear = yearCounts[user] || 0;

    if (uMonth === 0 && uYear === 0) {
      return res.end(`🌸${user}🌸님은 아직 출석 기록이 없습니다.`);
    }

    // 3. 등수 계산 (나보다 횟수가 많은 사람 + 1)
    const mRank = Object.values(monthCounts).filter(c => c > uMonth).length + 1;
    const yRank = Object.values(yearCounts).filter(c => c > uYear).length + 1;

    // 4. 결과 출력 (횟수 포함)
    const monthNum = Number(thisMonth.split("-")[1]);
    const yearShort = thisYear.slice(2);

    return res.end(`🌸${user}🌸 ${monthNum}월 ${mRank}등(${uMonth}회), ${yearShort}년 ${yRank}등(${uYear}회)`);
  }
  
  res.end("OK");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("server running on " + PORT);
});

