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
// 방어권 자동 계산 함수 (기본 1개 + 30회당 추가 - 사용한 개수)
// =====================
function getUserTokens(totalCount, usedTokenCount) {
  const earnedTokens = 1 + Math.floor(totalCount / 30);
  const currentTokens = earnedTokens - usedTokenCount;
  return Math.max(0, currentTokens);
}

// =====================
// 방어권 소모를 반영한 스마트 스트릭 계산 함수 (하루 공백만 방어)
// =====================
function calculateStreakWithTokens(today, dateSet) {
  const getPrevDate = (dateStr) => {
    const d = new Date(dateStr);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };

  let streak = 1;
  let checkDate = today;
  let tokensUsed = 0;

  while (true) {
    const prev = getPrevDate(checkDate);
    
    if (dateSet.has(prev)) {
      // 바로 전날 출석 기록이 있으면 정상 누적
      streak++;
      checkDate = prev;
    } else {
      // 전날 기록이 비어있음 -> '딱 하루'만 빠졌는지 확인 (다전날에 출석 기록이 있는지 체크)
      const prevOfPrev = getPrevDate(prev);
      
      if (dateSet.has(prevOfPrev)) {
        const currentTotal = dateSet.size;
        const available = getUserTokens(currentTotal, tokensUsed);
        
        if (available > 0) {
          tokensUsed++;
          streak++;
          checkDate = prevOfPrev; // 하루 공백을 방어권으로 메우고 그 전날로 이동
        } else {
          break; // 방어권 없으면 컷
        }
      } else {
        // 다전날에도 기록이 없다면? -> 2일 이상 연속으로 안 한 것이므로 방어 불가! 컷
        break;
      }
    }
  }

  return { streak, tokensUsed };
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

    const { data: allLogs } = await supabase
      .from("attendance")
      .select("date")
      .eq("username", user);

    const dateSet = new Set((allLogs ?? []).map(v => v.date));
    const alreadyChecked = dateSet.has(today);

    if (!alreadyChecked) {
      await supabase.from("attendance").insert([
        {
          username: user,
          date: today,
          month: thisMonth,
          year: thisYear,
          time: Date.now()
        }
      ]);
      dateSet.add(today);
    }

    const { streak, tokensUsed } = calculateStreakWithTokens(today, dateSet);
    const isGraceUsed = tokensUsed > 0 && !alreadyChecked;

    const now = getKSTNow();
    let hour = now.getUTCHours();
    let min = now.getUTCMinutes();

    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;

    const timeStr =
      `${String(hour12).padStart(2, "0")}:` +
      `${String(min).padStart(2, "0")}${ampm}`;

    let message;
    if (lang === "en") {
      let streakMsg = "";
      if (streak >= 2) {
        if (isGraceUsed) {
          streakMsg = ` 🛡️Streak Shield consumed, streak maintained! 🔥${streak}-day streak completed`;
        } else {
          streakMsg = ` 🔥${streak}-day streak completed`;
        }
      }

      if (alreadyChecked) {
        message = streak >= 2
          ? `🌸${user}🌸 [${timeStr}${streakMsg} confirmed]🐾Have a great day!`
          : `🌸${user}🌸 [${timeStr} Check-in confirmed]🐾Have a great day!`;
      } else {
        message = streak >= 2
          ? `🌸${user}🌸 [${timeStr}${streakMsg}]🐾Have a great day!`
          : `🌸${user}🌸 [${timeStr} Check-in completed]🐾Have a great day!`;
      }
    } else {
      let streakMsg = "";
      if (streak >= 2) {
        if (isGraceUsed) {
          streakMsg = ` 🛡️방어권이 소모되어 연속 출석이 유지되었습니다! 🔥${streak}일 연속출석완료`;
        } else {
          streakMsg = ` 🔥${streak}일 연속출석완료`;
        }
      }

      if (alreadyChecked) {
        message = streak >= 2
          ? `🌸${user}🌸 [${timeStr}${streakMsg} 재확인]🐾오늘 하루도 힘내요!`
          : `🌸${user}🌸 [출석완료 재확인]🐾오늘 하루도 힘내요!`;
      } else {
        message = streak >= 2
          ? `🌸${user}🌸 [${timeStr}${streakMsg}]🐾오늘 하루도 힘내요!`
          : `🌸${user}🌸 [${timeStr} 출석완료]🐾오늘 하루도 힘내요!`;
      }
    }

    return res.end(message);
  }

  // =====================
  // 2️⃣ 개인 체크 (/check)
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
      .gte("date", `${thisYear}-01-01`)
      .lte("date", `${thisYear}-12-31`);

    const { data: allLogs } = await supabase
      .from("attendance")
      .select("date")
      .eq("username", user)
      .gte("date", `${thisYear}-01-01`)
      .lte("date", `${thisYear}-12-31`);
    
    const dateSet = new Set((allLogs ?? []).map(v => v.date));
    const totalCount = dateSet.size;
    
    const currentTokens = getUserTokens(totalCount, 0); 

    const sortedDates = [...dateSet]
      .map(d => new Date(d))
      .sort((a, b) => a - b);
    
    let bestStreak = 0;
    let tempStreak = 0;

    for (let i = 0; i < sortedDates.length; i++) {
      if (i === 0) {
        tempStreak = 1;
      } else {
        const diffDays = Math.round((sortedDates[i].getTime() - sortedDates[i - 1].getTime()) / 86400000);
        
        if (diffDays === 1) {
          tempStreak++;
        } else if (diffDays === 2) {
          tempStreak += 2;
        } else {
          tempStreak = 1;
        }
      }
      bestStreak = Math.max(bestStreak, tempStreak);
    }
    const missionCount = Math.floor(bestStreak / 7);

    if (lang === "en") {
      const engMonth = getEnglishMonthName(monthNumber);
      const shortYear = thisYear.slice(2);
      return res.end(
        `🌸${user}🌸 ${engMonth} ${monthCount || 0} times, ${shortYear} year ${yearCount || 0} times (🔥Weekly Perfect Attendance ${missionCount} times | Streak Shield 🛡️${currentTokens} shields)`
      );
    } else {
      const shortYear = thisYear.slice(2);
      return res.end(
        `🌸${user}🌸 ${monthNumber}월 ${monthCount || 0}회, ${shortYear}년 ${yearCount || 0}회(🔥일주일 개근상 ${missionCount}회 | 연속출석 방어권 🛡️${currentTokens}개)`
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

    if (lang === "en") {
      const engMonth = getEnglishMonthName(monthNumber);
      return res.end(
        `${engMonth} Ranking TOP3：` +
        top.map((v, i) => `${medals[i]}${v[0]}(${v[1]} times)`).join(", ")
      );
    } else {
      return res.end(
        `${monthNumber}월 랭킹 TOP3：` +
        top.map((v, i) => `${medals[i]}${v[0]}(${v[1]}회)`).join(", ")
      );
    }
  }

  // =====================
  // 4️⃣ 연간 랭킹 (/legend)
  // =====================
  if (path === "/legend") {
    const { data } = await supabase
      .from("attendance")
      .select("username")
      .gte("date", `${thisYear}-01-01`)
      .lte("date", `${thisYear}-12-31`);

    const count = {};
    (data ?? []).forEach(d => {
      count[d.username] = (count[d.username] || 0) + 1;
    });

    const top = Object.entries(count)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const medals = ["🥇", "🥈", "🥉"];

    if (lang === "en") {
      return res.end(
        `${thisYear} Year Ranking TOP3：` +
        top.map((v, i) => `${medals[i]}${v[0]}(${v[1]} times)`).join(", ")
      );
    } else {
      return res.end(
        `${thisYear.slice(2)}년 랭킹 TOP3：` +
        top.map((v, i) => `${medals[i]}${v[0]}(${v[1]}회)`).join(", ")
      );
    }
  }

  // =====================
  // 5️⃣ 개인 등수 확인 (/rankcheck)
  // =====================
  if (path === "/rankcheck") {
    if (!user) return res.end("유저 없음");

    try {
      const { data: monthData } = await supabase
        .from("attendance")
        .select("username")
        .eq("month", thisMonth);

      const { data: yearData } = await supabase
        .from("attendance")
        .select("username")
        .gte("date", `${thisYear}-01-01`)
        .lte("date", `${thisYear}-12-31`);

      const countMap = (data) => {
        const c = {};
        (data || []).forEach(d => { c[d.username] = (c[d.username] || 0) + 1; });
        return c;
      };

      const monthCounts = countMap(monthData);
      const yearCounts = countMap(yearData);

      const uMonth = monthCounts[user] || 0;
      const uYear = yearCounts[user] || 0;

      if (uMonth === 0 && uYear === 0) {
        return lang === "en" 
          ? `🌸${user}🌸 You have no attendance records yet.`
          : `🌸${user}🌸님은 아직 출석 기록이 없습니다.`;
      }

      const mRank = Object.values(monthCounts).filter(c => c > uMonth).length + 1;
      const yRank = Object.values(yearCounts).filter(c => c > uYear).length + 1;

      const sameMonthCount = Object.values(monthCounts).filter(c => c === uMonth).length;
      const sameYearCount = Object.values(yearCounts).filter(c => c === uYear).length;

      const monthNum = Number(thisMonth.split("-")[1]);
      const yearShort = thisYear.slice(2);

      if (lang === "en") {
        const mDisplay = sameMonthCount > 1 ? `Joint ${mRank}th` : `${mRank}th`;
        const yDisplay = sameYearCount > 1 ? `Joint ${yRank}th` : `${yRank}th`;
        const engMonth = getEnglishMonthName(monthNum);
        return res.end(`🌸${user}🌸 ${engMonth} ${mDisplay}(${uMonth} times), ${thisYear} ${yDisplay}(${uYear} times)`);
      } else {
        const mDisplay = sameMonthCount > 1 ? `공동 ${mRank}등` : `${mRank}등`;
        const yDisplay = sameYearCount > 1 ? `공동 ${yRank}등` : `${yRank}등`;
        return res.end(`🌸${user}🌸 ${monthNum}월 ${mDisplay}(${uMonth}회), ${yearShort}년 ${yDisplay}(${uYear}회)`);
      }

    } catch (err) {
      console.error(err);
      return res.end(lang === "en" ? `🌸${user}🌸 Error loading data.` : `🌸${user}🌸 데이터를 불러오는 중 오류가 발생했습니다.`);
    }
  }
  
  res.end("OK");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("server running on " + PORT);
});