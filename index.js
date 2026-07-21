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

  const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return {
    date: dateStr,
    month: dateStr.slice(0, 7), // "YYYY-MM"
    year: dateStr.slice(0, 4)   // "YYYY"
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

// 날짜 문자열 계산 헬퍼
function getPrevDate(dateStr) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// =====================
// 페이징 제한 우회 데이터 조회 헬퍼
// =====================
async function fetchAllData(queryBuilder) {
  let allData = [];
  let rangeSize = 1000;
  let from = 0;
  let to = rangeSize - 1;
  let keepFetching = true;

  while (keepFetching) {
    const { data, error } = await queryBuilder.range(from, to);

    if (error || !data || data.length === 0) {
      keepFetching = false;
    } else {
      allData = allData.concat(data);
      if (data.length < rangeSize) {
        keepFetching = false;
      } else {
        from += rangeSize;
        to += rangeSize;
      }
    }
  }
  return allData;
}

// =====================
// 서버 구동
// =====================
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  
  const rawUser = (parsed.query.user || "").trim();
  const dbUser = rawUser.toLowerCase();
  
  const lang = (parsed.query.lang || "ko").toLowerCase();
  const game = getGameDay();

  const today = game.date;
  const thisMonth = game.month;
  const thisYear = game.year;

  // =====================
  // 1️⃣ 출석 (/attend)
  // =====================
  if (path === "/attend") {
    if (!rawUser) return res.end("유저 없음");

    const { data: userRecord } = await supabase
      .from("users")
      .select("has_shield")
      .eq("username", dbUser)
      .single();

    const allLogs = await fetchAllData(
      supabase
        .from("attendance")
        .select("date")
        .eq("username", dbUser)
    );

    const dateSet = new Set((allLogs ?? []).map(v => v.date));
    const alreadyChecked = dateSet.has(today);

    let streak = 1;
    let usedShield = false;
    let hasShield = userRecord ? userRecord.has_shield : true; 

    if (!alreadyChecked) {
      const prevDate = getPrevDate(today);
      const isYesterdayChecked = dateSet.has(prevDate);

      if (isYesterdayChecked) {
        let checkDate = prevDate;
        let currentStreakCount = 1; 
        
        while (dateSet.has(checkDate)) {
          currentStreakCount++;
          checkDate = getPrevDate(checkDate);
        }
        streak = currentStreakCount;
        hasShield = userRecord ? userRecord.has_shield : true;
      } else {
        const prevPrevDate = getPrevDate(prevDate);
        const isPrevPrevChecked = dateSet.has(prevPrevDate);

        if (hasShield && isPrevPrevChecked) {
          usedShield = true;
          hasShield = false; 

          let checkDate = prevPrevDate;
          let currentStreakCount = 2; 
          
          while (dateSet.has(checkDate)) {
            currentStreakCount++;
            checkDate = getPrevDate(checkDate);
          }
          streak = currentStreakCount;
        } else {
          streak = 1;
          hasShield = true; 
        }
      }

      await supabase.from("attendance").insert([
        {
          username: dbUser,
          date: today,
          month: thisMonth,
          year: thisYear,
          time: Date.now()
        }
      ]);

      dateSet.add(today);

      await supabase
        .from("users")
        .upsert({ username: dbUser, streak: streak, last_date: today, has_shield: hasShield });
    } else {
      let checkDate = today;
      let currentStreakCount = 0;
      
      while (dateSet.has(checkDate)) {
        currentStreakCount++;
        checkDate = getPrevDate(checkDate);
      }
      streak = currentStreakCount > 0 ? currentStreakCount : 1;
    }

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
        streakMsg = ` 🔥${streak}-day streak completed`;
      }

      let shieldMsg = usedShield ? " (🛡️Oops, you missed a day, but your streak is protected!)" : "";

      if (alreadyChecked) {
        message = streak >= 2
          ? `🌸${rawUser}🌸 [${timeStr}${streakMsg} confirmed${shieldMsg}]🐾Have a great day!`
          : `🌸${rawUser}🌸 [${timeStr} Check-in confirmed${shieldMsg}]🐾Have a great day!`;
      } else {
        message = streak >= 2
          ? `🌸${rawUser}🌸 [${timeStr}${streakMsg}${shieldMsg}]🐾Have a great day!`
          : `🌸${rawUser}🌸 [${timeStr} Check-in completed${shieldMsg}]🐾Have a great day!`;
      }
    } else {
      let streakMsg = "";
      if (streak >= 2) {
        streakMsg = ` 🔥${streak}일 연속출석완료`;
      }

      let shieldMsg = usedShield ? " (🛡️하루 쉬셨지만 연속출석은 지켜드렸어요)" : "";

      if (alreadyChecked) {
        message = streak >= 2
          ? `🌸${rawUser}🌸 [${timeStr}${streakMsg} 재확인${shieldMsg}]🐾오늘 하루도 힘내요!`
          : `🌸${rawUser}🌸 [출석완료 재확인${shieldMsg}]🐾오늘 하루도 힘내요!`;
      } else {
        message = streak >= 2
          ? `🌸${rawUser}🌸 [${timeStr}${streakMsg}${shieldMsg}]🐾오늘 하루도 힘내요!`
          : `🌸${rawUser}🌸 [${timeStr} 출석완료${shieldMsg}]🐾오늘 하루도 힘내요!`;
      }
    }

    return res.end(message);
  }

  // =====================
  // 2️⃣ 개인 체크 (/check)
  // =====================
  if (path === "/check") {
    if (!rawUser) return res.end("유저 없음");

    const monthNumber = Number(thisMonth.split("-")[1]);

    const monthData = await fetchAllData(
      supabase
        .from("attendance")
        .select("*")
        .eq("username", dbUser)
        .eq("month", thisMonth)
    );
    const monthCount = monthData.length;

    const yearLogs = await fetchAllData(
      supabase
        .from("attendance")
        .select("date")
        .eq("username", dbUser)
        .like("date", `${thisYear}%`)
    );
    const yearCount = yearLogs.length;

    const sortedDates = [...(yearLogs ?? [])]
      .map(v => new Date(v.date))
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
        `🌸${rawUser}🌸 ${engMonth} ${monthCount || 0} times, ${shortYear} year ${yearCount || 0} times (🔥7-day streak success ${missionCount} times)`
      );
    } else {
      const shortYear = thisYear.slice(2);
      return res.end(
        `🌸${rawUser}🌸 ${monthNumber}월 ${monthCount || 0}회, ${shortYear}년 ${yearCount || 0}회(🔥일주일 연속출석 성공 ${missionCount}회)`
      );
    }
  }

  // =====================
  // 3️⃣ 월 랭킹 (/rank)
  // =====================
  if (path === "/rank") {
    const monthNumber = Number(thisMonth.split("-")[1]);
    const data = await fetchAllData(
      supabase
        .from("attendance")
        .select("username")
        .eq("month", thisMonth)
    );

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
    const data = await fetchAllData(
      supabase
        .from("attendance")
        .select("username")
        .like("date", `${thisYear}%`)
    );

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
    if (!rawUser) return res.end("유저 없음");

    try {
      const monthData = await fetchAllData(
        supabase
          .from("attendance")
          .select("username")
          .eq("month", thisMonth)
      );

      const yearData = await fetchAllData(
        supabase
          .from("attendance")
          .select("username")
          .like("date", `${thisYear}%`)
      );

      const countMap = (data) => {
        const c = {};
        (data || []).forEach(d => { c[d.username] = (c[d.username] || 0) + 1; });
        return c;
      };

      const monthCounts = countMap(monthData);
      const yearCounts = countMap(yearData);

      const uMonth = monthCounts[dbUser] || 0;
      const uYear = yearCounts[dbUser] || 0;

      if (uMonth === 0 && uYear === 0) {
        return res.end(lang === "en" 
          ? `🌸${rawUser}🌸 You have no attendance records yet.`
          : `🌸${rawUser}🌸님은 아직 출석 기록이 없습니다.`);
      }

      const mRank = Object.values(monthCounts).filter(c => c > uMonth).length + 1;
      const yRank = Object.values(yearCounts).filter(c => c > uYear).length + 1;

      const sameMonthCount = Object.values(monthCounts).filter(c => c === uMonth).length;
      const sameYearCount = Object.values(yearCounts).filter(c => c === uYear).length;

      const monthNum = Number(thisMonth.split("-")[1]);
      const yearShort = thisYear.slice(2);

      if (lang === "en") {
        const mDisplay = sameMonthCount > 1 ? `Joint ${mRank}th` : `Solo ${mRank}th`;
        const yDisplay = sameYearCount > 1 ? `Joint ${yRank}th` : `Solo ${yRank}th`;
        const engMonth = getEnglishMonthName(monthNum);
        return res.end(`🌸${rawUser}🌸 ${engMonth} ${mDisplay}(${uMonth} times), ${thisYear} ${yDisplay}(${uYear} times)`);
      } else {
        const mDisplay = sameMonthCount > 1 ? `공동 ${mRank}등` : `단독 ${mRank}등`;
        const yDisplay = sameYearCount > 1 ? `공동 ${yRank}등` : `단독 ${yRank}등`;
        return res.end(`🌸${rawUser}🌸 ${monthNum}월 ${mDisplay}(${uMonth}회), ${yearShort}년 ${yDisplay}(${uYear}회)`);
      }

    } catch (err) {
      console.error(err);
      return res.end(lang === "en" ? `🌸${rawUser}🌸 Error loading data.` : `🌸${rawUser}🌸 데이터를 불러오는 중 오류가 발생했습니다.`);
    }
  }
  
  res.end("OK");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("server running on " + PORT);
});