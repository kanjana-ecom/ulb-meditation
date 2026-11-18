/* mock.js — ใช้เฉพาะโหมดทดลอง (?mock=1) ไม่จำเป็นต้องอัปโหลดขึ้นเว็บจริง */
(function () {
/* Pure scoring logic (no Google services — tested with Node)          */
/* ================================================================== */

function ymd_(d) { return [+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)]; }
function addDays(d, n) {
  var p = ymd_(d);
  return new Date(Date.UTC(p[0], p[1], p[2]) + n * 86400000).toISOString().slice(0, 10);
}
function dayOfWeek(d) { // 0 = Monday … 6 = Sunday
  var p = ymd_(d);
  return (new Date(Date.UTC(p[0], p[1], p[2])).getUTCDay() + 6) % 7;
}
function weekStart(d) { return addDays(d, -dayOfWeek(d)); }
function monthStart(d) { return d.slice(0, 8) + '01'; }
function monthEnd(d) {
  var p = ymd_(d);
  return new Date(Date.UTC(p[0], p[1] + 1, 0)).toISOString().slice(0, 10);
}
var DEFAULT_RULES = { maxPerDay: 3, windowDays: 28, lv1: 48, lv2: 80, lv3: 104, lv4Streak: 28, lv5Streak: 56 };

/**
 * คะแนน: นั่ง 1 ครั้ง = 1 คะแนน (นับสูงสุด maxPerDay ครั้ง/วัน) + วันไหนนั่งครบ = โบนัส 1 คะแนน
 * Level ใช้คะแนนย้อนหลัง windowDays วัน (rolling) — คะแนนเก่าหลุดออกทุกวัน ไม่มีวันรีเซ็ต
 */
function computeState(members, sessions, today, nowMs, meId, groups, rules) {
  var R = {};
  Object.keys(DEFAULT_RULES).forEach(function (k) { R[k] = (rules && rules[k] != null && rules[k] !== '') ? Number(rules[k]) : DEFAULT_RULES[k]; });
  var max = R.maxPerDay, W = R.windowDays;
  var counts = {};
  sessions.forEach(function (s) {
    var c = counts[s.userId] || (counts[s.userId] = {});
    c[s.date] = (c[s.date] || 0) + 1;
  });
  function n(u, d) { return Math.min(max, (counts[u] && counts[u][d]) || 0); }
  function full(u, d) { return n(u, d) >= max; }
  function pts(u, d) { var k = n(u, d); return k + (k >= max ? 1 : 0); }
  var winStart = addDays(today, -(W - 1));
  function sumPts(u, from, to) { var t = 0, d = from; while (d <= to) { t += pts(u, d); d = addDays(d, 1); } return t; }
  function countRange(u, from, to) { var t = 0, d = from; while (d <= to) { t += n(u, d); d = addDays(d, 1); } return t; }
  function streak(u) {
    var d = full(u, today) ? today : addDays(today, -1), s = 0;
    while (full(u, d) && s < 1000) { s++; d = addDays(d, -1); }
    return s;
  }
  function levelOf(score, st) {
    if (st >= R.lv5Streak) return 5;
    if (st >= R.lv4Streak) return 4;
    if (score >= R.lv3) return 3;
    if (score >= R.lv2) return 2;
    if (score >= R.lv1) return 1;
    return 0;
  }
  function cup(mStart, upTo) {
    var byUlb = {};
    members.forEach(function (m) { if (m.joined <= upTo) (byUlb[m.ulb] || (byUlb[m.ulb] = [])).push(m); });
    var lanes = Object.keys(byUlb).map(function (k) {
      var list = byUlb[k], sum = 0, bonus = 0, d = mStart;
      list.forEach(function (m) { sum += sumPts(m.userId, mStart, upTo); });
      while (d <= upTo) {
        var active = list.filter(function (m) { return m.joined <= d; });
        if (active.length && active.every(function (m) { return full(m.userId, d); })) bonus++;
        d = addDays(d, 1);
      }
      // คะแนนรุ่น = คะแนนเฉลี่ยต่อคนในเดือนนี้ + วันที่ครบทั้งทีม (วันละ +1)
      return { ulb: +k, members: list.length, bonusDays: bonus, score: Math.round((sum / list.length + bonus) * 10) / 10 };
    });
    lanes.sort(function (a, b) { return b.score - a.score || a.ulb - b.ulb; });
    return lanes;
  }

  var byId = {}, me = null;
  members.forEach(function (m) { byId[m.userId] = m; if (m.userId === meId) me = m; });
  var mStart = monthStart(today);
  var lanes = cup(mStart, today);
  var prevEnd = addDays(mStart, -1);
  var prevLanes = cup(monthStart(prevEnd), prevEnd);

  var ranking = members.map(function (m) {
    var sc = sumPts(m.userId, winStart, today);
    return {
      nickname: m.nickname, picture: m.picture || '', ulb: m.ulb, me: m.userId === meId,
      today: n(m.userId, today), score: sc, month: countRange(m.userId, mStart, today),
      level: levelOf(sc, streak(m.userId))
    };
  });

  var recent = sessions
    .filter(function (s) { return byId[s.userId] && nowMs - s.at < 24 * 3600 * 1000 && s.at <= nowMs; })
    .sort(function (a, b) { return b.at - a.at; })
    .slice(0, 5)
    .map(function (s) {
      var m = byId[s.userId], nth = 0;
      sessions.forEach(function (x) { if (x.userId === s.userId && x.date === s.date && x.at <= s.at) nth++; });
      return { nickname: m.nickname, picture: m.picture || '', ulb: m.ulb, nth: Math.min(nth, max), at: s.at, me: s.userId === meId };
    });

  var out = {
    today: today,
    maxPerDay: max,
    rules: R,
    totalMembers: members.length,
    satToday: members.filter(function (m) { return n(m.userId, today) > 0; }).length,
    recent: recent,
    ranking: ranking,
    cup: {
      month: today.slice(0, 7),
      daysLeft: Math.round((Date.parse(monthEnd(today)) - Date.parse(today)) / 86400000),
      lanes: lanes,
      lastChampion: prevLanes.length && prevLanes[0].score > 0 ? prevLanes[0].ulb : null
    }
  };

  if (me) {
    var u = me.userId, score = sumPts(u, winStart, today), st = streak(u), lv = levelOf(score, st);
    var last7 = [];
    for (var i = 6; i >= 0; i--) { var d = addDays(today, -i); last7.push({ date: d, dow: dayOfWeek(d), n: n(u, d) }); }
    var fullDays = 0;
    for (var j = 0; j < W; j++) if (full(u, addDays(today, -j))) fullDays++;
    var next = null;
    if (lv < 3) { var goal = [R.lv1, R.lv2, R.lv3][lv]; next = { level: lv + 1, points: goal - score }; }
    else if (lv < 5) { var g2 = lv === 3 ? R.lv4Streak : R.lv5Streak; next = { level: lv + 1, days: g2 - st }; }
    var myIdx = -1;
    lanes.forEach(function (l, k) { if (l.ulb === me.ulb) myIdx = k; });
    var gap = null;
    if (myIdx > 0) {
      var above = lanes[myIdx - 1], mine = lanes[myIdx];
      gap = { ulb: above.ulb, points: Math.max(1, Math.ceil((above.score - mine.score) * mine.members - 1e-9)) };
    }
    out.me = {
      nickname: me.nickname, picture: me.picture || '', ulb: me.ulb,
      todayN: n(u, today),
      todayPts: pts(u, today),
      score: score,
      maxScore: W * (max + 1),
      fullDays: fullDays,
      streak: st,
      level: lv,
      next: next,
      dropTomorrow: pts(u, winStart),
      last7: last7,
      ulbRank: myIdx + 1,
      ulbGap: gap,
      team: members.filter(function (m) { return m.ulb === me.ulb; }).map(function (m) {
        return { nickname: m.nickname, picture: m.picture || '', todayN: n(m.userId, today), me: m.userId === meId };
      }),
      groupUrl: (groups && groups[me.ulb]) || ''
    };
  }
  return out;
}

  function bkk(ms) { return new Date(ms + 7 * 3600000).toISOString().slice(0, 10); }
  var ME = 'me';
  function FACE(i) { var c = ['#6C8EBF','#B85450','#82B366','#D6B656','#9673A6','#5B6478'][i % 6];
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="' + c + '"/><circle cx="20" cy="16" r="7" fill="#fff" opacity=".9"/><rect x="9" y="26" width="22" height="14" rx="7" fill="#fff" opacity=".9"/></svg>'); }
  var names = [['อร',2],['ต้น',1],['นุ่น',4],['โอ๊ต',5],['มิ้นท์',5],['เอก',3],['แพร',7],['บอย',2],['ปุ้ย',9],['หมี',6],['จิ๋ว',8],['ฟ้า',3],['เก่ง',4],['แอน',6],['ปอ',8],['นัท',9],['บีม',1],['จูน',7]];
  var members = [], sessions = [];
  var now = Date.now(), today = bkk(now);
  names.forEach(function (x, i) { members.push({ userId: 'u' + i, nickname: x[0], ulb: x[1], joined: '2026-01-01', picture: i % 3 === 0 ? 'https://example.invalid/p' + i + '.jpg' : (i % 3 === 1 ? FACE(i) : '') }); });
  var seed = 7;
  function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
  members.forEach(function (m, i) {
    var habit = 0.35 + (i % 6) * 0.11;
    for (var d = 40; d >= 1; d--) {
      var date = addDays(today, -d), k = 0;
      for (var j = 0; j < 3; j++) if (rnd() < habit) k++;
      for (var j2 = 0; j2 < k; j2++) sessions.push({ userId: m.userId, date: date, at: now - d * 86400000 + j2 * 3600000 });
    }
    var t = Math.floor(rnd() * 3);
    for (var j3 = 0; j3 < t; j3++) sessions.push({ userId: m.userId, date: today, at: now - (5 + i * 7 + j3 * 90) * 60000 });
  });
  var registered = new URLSearchParams(location.search).get('new') !== '1';
  if (registered) {
    members.push({ userId: ME, nickname: 'กานต์', ulb: 1, joined: '2026-01-01' });
    [[-20, 3], [-18, 3], [-16, 2], [-15, 3], [-13, 3], [-11, 3], [-9, 2], [-8, 3], [-6, 3], [-4, 3], [-3, 3], [-2, 2], [-1, 3], [0, 2]].forEach(function (x) {
      for (var j = 0; j < x[1]; j++) sessions.push({ userId: ME, date: addDays(today, x[0]), at: now + x[0] * 86400000 - (200 - j * 60) * 60000 });
    });
  }
  var GROUPS = { 1: 'https://line.me/R/ti/g/example', 2: '', 3: '', 4: '', 5: '', 6: '', 7: '', 8: '', 9: '' };
  function state() { var s = computeState(members, sessions, bkk(Date.now()), Date.now(), ME, GROUPS, {}); s.ulbList = Object.keys(GROUPS).map(Number); return s; }
  function api(action, data) {
    data = data || {};
    var res;
    if (action === 'auth') res = { ok: true, token: 'mock', registered: registered, ulbList: Object.keys(GROUPS).map(Number), state: registered ? state() : null };
    else if (action === 'register') {
      registered = true;
      members = members.filter(function (m) { return m.userId !== ME; });
      members.push({ userId: ME, nickname: data.nickname, ulb: +data.ulb, joined: bkk(Date.now()) });
      res = { ok: true, state: state() };
    }
    else if (action === 'state') res = { ok: true, state: state() };
    else if (action === 'start') res = { ok: true };
    else if (action === 'finish') {
      var before = state().me, counted = false;
      if (before.todayN < 3) { sessions.push({ userId: ME, date: bkk(Date.now()), at: Date.now() }); counted = true; }
      res = { ok: true, counted: counted, before: before, state: state() };
    }
    return new Promise(function (r) { setTimeout(function () { r(JSON.parse(JSON.stringify(res))); }, 150); });
  }
  var liff = {
    init: function () { return Promise.resolve(); },
    isLoggedIn: function () { return true; },
    login: function () {},
    getIDToken: function () { return 'mock'; },
    getDecodedIDToken: function () { return { name: 'Karn' }; },
    getContext: function () { return { type: 'external' }; },
    isApiAvailable: function () { return true; },
    shareTargetPicker: function (m) { window.__lastShare = m; return Promise.resolve({ status: 'success' }); },
    sendMessages: function (m) { window.__lastShare = m; return Promise.resolve(); }
  };
  window.ULBMock = { boot: function () { return Promise.resolve({ api: api, liff: liff }); } };
})();
