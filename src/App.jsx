import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  currentRocPeriod,
  formatPeriod,
  isUnlocked,
  loadStudyData,
  PERIODS,
} from "./data";
import {
  getAll,
  loadSnapshot,
  migrateLegacyProgress,
  notifyRemoteApplied,
  put,
  REMOTE_APPLIED_EVENT,
  resetReissuedProgress,
  restoreSnapshot,
} from "./db";
import { getJapaneseVoices, speakJapanese, stopSpeech } from "./speech";
import { calculateDailyProgress } from "./dailyProgress";
import { planToday, unlockedThrough as unlockedThroughFor } from "./unlockSchedule";
import { studyBalance } from "./studyBalance";
import { buildMonthlyReport, reportablePeriods } from "./monthlyReport";
import DriveSyncPanel from "./DriveSyncPanel";
import { buildQuizQuestion, buildStudyQuiz, rememberQuizRound } from "./studyQuiz";
import {
  MASTERY_STREAK,
  markAlreadyKnown,
  nextProgressFromAnswer,
  roundCards,
} from "./studyRating";
import {
  DEFAULT_SCHEDULE_SETTINGS,
  normalizeScheduleSettings,
  withScheduleUpdatedAt,
} from "./scheduleSettings";
import { useGoogleDriveSync } from "./useGoogleDriveSync";

const NAV = [
  ["today", "今日學習", "今"],
  ["library", "教材庫", "本"],
  ["media", "閱讀聽力", "聽"],
  ["mock", "模考", "試"],
  ["progress", "進度成果", "績"],
  ["settings", "設定", "設"],
];
const EMPTY = {
  vocabulary: [],
  grammar: [],
  reading: [],
  listening: [],
  assessments: [],
  index: { counts: {} },
};
const STRONG_RATINGS = new Set(["good", "easy"]);
const LIBRARY_PAGE_SIZES = [30, 60, 120];
const DEFAULT_PAGE_STATES = {
  today: {
    scrollY: 0,
    quiz: null,
    recentQuizRounds: [],
    reviewRound: 0,
  },
  library: {
    query: "",
    type: "vocabulary",
    onlyWeak: false,
    page: 1,
    pageSize: 30,
    scrollY: 0,
  },
  media: {
    type: "reading",
    selected: 0,
    transcript: false,
    answers: {},
    replays: 0,
    elapsed: 0,
    startedAt: null,
    summaries: {},
    scrollY: 0,
  },
  mock: {
    examId: null,
    answers: {},
    startedAt: null,
    review: null,
    scrollY: 0,
  },
  progress: { scrollY: 0, reportPeriod: null },
  settings: { scrollY: 0 },
};

function mergeUiSession(saved, defaultPeriod) {
  const pages = Object.fromEntries(
    Object.entries(DEFAULT_PAGE_STATES).map(([key, value]) => [
      key,
      { ...value, ...(saved?.pages?.[key] || {}) },
    ]),
  );
  // `viewPeriod` is only which month the learner is browsing. Unlocking is derived
  // from the date now.
  //
  // The legacy `activePeriod` is deliberately NOT inherited: it doubled as the
  // unlock gate and was frozen at whichever month the app was first opened, so a
  // saved 115-07 was never a browsing choice the learner made. Carrying it over
  // would leave old sessions parked on the wrong month.
  const savedPeriod = saved?.viewPeriod;
  const candidate = PERIODS.includes(savedPeriod) ? savedPeriod : defaultPeriod;
  // Still clamped, so a session restored from Drive cannot point past today.
  const viewPeriod =
    PERIODS.indexOf(candidate) > PERIODS.indexOf(defaultPeriod)
      ? defaultPeriod
      : candidate;
  return {
    view: NAV.some(([id]) => id === saved?.view) ? saved.view : "today",
    viewPeriod,
    pages,
    updatedAt: saved?.updatedAt || new Date(0).toISOString(),
  };
}

function useUiSession(defaultPeriod) {
  const [session, setSession] = useState(() =>
    mergeUiSession(null, defaultPeriod),
  );
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const load = () =>
      getAll("settings")
        .then((items) => {
          let local = null;
          try {
            local = JSON.parse(
              localStorage.getItem("nihongo-stairs-ui-session"),
            );
          } catch {
            /* ignore malformed local mirror */
          }
          const stored = items.find((item) => item.id === "ui-session")?.value;
          const saved =
            new Date(local?.updatedAt || 0) > new Date(stored?.updatedAt || 0)
              ? local
              : stored;
          setSession(mergeUiSession(saved, defaultPeriod));
        })
        .finally(() => setReady(true));
    void load();
    window.addEventListener(REMOTE_APPLIED_EVENT, load);
    return () => window.removeEventListener(REMOTE_APPLIED_EVENT, load);
  }, [defaultPeriod]);
  useEffect(() => {
    if (!ready) return;
    localStorage.setItem("nihongo-stairs-ui-session", JSON.stringify(session));
    void put("settings", { id: "ui-session", value: session });
  }, [ready, session]);
  const updatePage = useCallback(
    (page, updater) =>
      setSession((current) => {
        const previous = current.pages[page] || {};
        const next =
          typeof updater === "function"
            ? updater(previous)
            : { ...previous, ...updater };
        return {
          ...current,
          pages: { ...current.pages, [page]: next },
          updatedAt: new Date().toISOString(),
        };
      }),
    [],
  );
  const setView = useCallback(
    (nextView) =>
      setSession((current) => ({
        ...current,
        view: nextView,
        pages: {
          ...current.pages,
          [current.view]: {
            ...current.pages[current.view],
            scrollY: window.scrollY,
          },
        },
        updatedAt: new Date().toISOString(),
      })),
    [],
  );
  const setViewPeriod = useCallback(
    (viewPeriod) =>
      setSession((current) => ({
        ...current,
        viewPeriod,
        updatedAt: new Date().toISOString(),
      })),
    [],
  );
  return { session, ready, updatePage, setView, setViewPeriod };
}

// Re-derives the unlocked period from the clock so a month or week boundary takes
// effect on a session that is simply left open, without a reload.
function useUnlockedThrough() {
  const [period, setPeriod] = useState(() => unlockedThroughFor());
  useEffect(() => {
    const tick = () => {
      const next = unlockedThroughFor();
      setPeriod((current) => (current === next ? current : next));
    };
    const timer = setInterval(tick, 60000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return period;
}

// The clock value the weekly cap is measured against. Kept in state for the same
// reason: crossing Monday midnight must lift the cap on an open session.
function useToday() {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const tick = () => {
      const next = new Date();
      setToday((current) =>
        current.toDateString() === next.toDateString() ? current : next,
      );
    };
    const timer = setInterval(tick, 60000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return today;
}

/**
 * One question of a study round.
 *
 * This replaced the flip card: daily study is answering, not revealing. The
 * answer panel therefore has to carry everything the card's back used to —
 * meaning, usage note, example, translation, audio — because this is now the
 * only place the learner is taught the word. Showing just "correct / wrong"
 * would quiz them on material they were never shown.
 */
function StudyQuizPanel({
  quiz,
  settings,
  cardsById,
  reviewMode = false,
  outstanding = 0,
  onAnswer,
  onNext,
  onFinish,
  onKnown = null,
}) {
  const questions = quiz?.questions || [];
  const currentIndex = Math.min(quiz?.current || 0, questions.length - 1);
  const question = questions[currentIndex];
  const answers = quiz?.answers || {};
  const answer = answers[currentIndex];
  const answeredCount = Object.keys(answers).length;
  const correctCount = Object.values(answers).filter((item) => item.correct)
    .length;
  const finished = questions.length > 0 && answeredCount >= questions.length;
  const cardRef = useRef(null);
  const advance = finished ? onFinish : onNext;
  // Advancing used to leave the reader parked wherever the previous answer had
  // pushed them — the new question rendered above the fold. Bring the card back
  // to the top of the viewport on every change instead.
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    // Measured after a frame: removing the previous answer panel shrinks the
    // page, so a position read during this render is already stale and lands
    // short of the question.
    // Straight after commit, with no animation and no rAF. The card's own top
    // does not move when the answer panel goes — the panel is inside it — so
    // there is nothing to wait for. Both alternatives were tried and neither
    // holds: a smooth scroll is cancelled by the page shrinking underneath it,
    // and a scroll issued from inside requestAnimationFrame is reset before the
    // next paint.
    const top = node.getBoundingClientRect().top + window.scrollY - 12;
    // Only ever scroll up — never drag the reader down to a card they can see.
    if (window.scrollY > top) window.scrollTo(0, top);
  }, [currentIndex, quiz?.id]);
  // On a keyboard: 1–4 answers, Enter or Space moves on. Cheap, and it makes a
  // long study session on a laptop far less tedious than reaching for the mouse.
  useEffect(() => {
    const onKey = (event) => {
      if (event.target.matches?.("input, textarea")) return;
      if (!answer && /^[1-4]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        if (index < (question?.options.length || 0)) {
          event.preventDefault();
          onAnswer(index);
        }
        return;
      }
      if (answer && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, question, onAnswer, advance]);
  if (!question) return null;
  const card = cardsById?.get(question.itemId);
  const streak = Number(answer?.streak) || 0;
  return (
    <div className="lesson-card study-quiz-card" ref={cardRef}>
      <div className="lesson-top">
        <span>
          {reviewMode ? "複習" : "本批練習"} · 第 {currentIndex + 1} /{" "}
          {questions.length} 題
        </span>
        <button onClick={() => speakJapanese(question.audioText, settings)}>
          播放題目
        </button>
      </div>
      <div className="study-quiz-main">
        <div className="study-quiz-prompt">
          <span className="quiz-type">
            {question.category === "grammar" ? "文法" : "單字"}
          </span>
          <h2>{question.term}</h2>
          <p className="reading">{question.reading}</p>
          <p>請選出最接近的中文意思。</p>
        </div>
        <div className="study-quiz-options">
          {question.options.map((option, optionIndex) => {
            const isSelected = answer?.selectedIndex === optionIndex;
            const isCorrect = question.correctIndex === optionIndex;
            const stateClass = answer
              ? isCorrect
                ? "correct"
                : isSelected
                  ? "wrong"
                  : ""
              : "";
            return (
              <button
                key={`${question.itemId}:${option}`}
                className={`${isSelected ? "selected" : ""} ${stateClass}`}
                disabled={Boolean(answer)}
                onClick={() => onAnswer(optionIndex)}
              >
                <b>{String.fromCharCode(65 + optionIndex)}</b>
                <span>{option}</span>
              </button>
            );
          })}
        </div>
        {answer && (
          <div
            className={`study-quiz-feedback ${
              answer.correct ? "correct" : "wrong"
            }`}
            role="status"
          >
            <strong>
              {answer.correct
                ? reviewMode
                  ? "答對了"
                  : streak >= MASTERY_STREAK
                    ? "答對了 · 這張達標"
                    : "答對了 · 再答對一次就達標"
                : "這題要再加強"}
            </strong>
            {/* The whole card, because this is where the word is taught now. */}
            {card ? (
              <div className="answer">
                <strong>{card.meaningZh}</strong>
                <span className="usage-note">{card.usageZh}</span>
                <div className="example-line">
                  <p>{card.examples?.[0]?.ja}</p>
                  <ExampleAudio
                    text={card.examples?.[0]?.ja}
                    settings={settings}
                  />
                </div>
                <ExampleTranslation example={card.examples?.[0]} />
              </div>
            ) : (
              <span>正確意思：{question.correctMeaning}</span>
            )}
            {onKnown && answer.correct && (
              <button
                className="text-button already-known"
                onClick={() => onKnown(question.itemId)}
              >
                很熟，別再問我
              </button>
            )}
          </div>
        )}
      </div>
      <footer className="study-quiz-footer">
        <span>
          已答 {answeredCount} · 正確 {correctCount} · 共 {questions.length}
          {!reviewMode && outstanding > 0 ? ` · 本批還剩 ${outstanding} 張` : ""}
          <b className="quiz-hint">
            {answer ? "Enter 繼續" : "按 1–4 選答案"}
          </b>
        </span>
        <button disabled={!answer} onClick={advance}>
          {finished ? (reviewMode ? "下一輪" : "完成這一輪") : "下一題"}
        </button>
      </footer>
    </div>
  );
}

function useLearningStore() {
  const [progress, setProgress] = useState({});
  const [events, setEvents] = useState([]);
  const [results, setResults] = useState([]);
  const [ready, setReady] = useState(false);
  const load = useCallback(async () => {
    const [savedProgress, savedEvents, savedResults] = await Promise.all([
      getAll("cardProgress"),
      getAll("studyEvents"),
      getAll("assessmentResults"),
    ]);
    setProgress(Object.fromEntries(savedProgress.map((x) => [x.id, x])));
    setEvents(savedEvents);
    setResults(savedResults);
  }, []);
  useEffect(() => {
    migrateLegacyProgress()
      .then(load)
      .finally(() => setReady(true));
    window.addEventListener(REMOTE_APPLIED_EVENT, load);
    return () => window.removeEventListener(REMOTE_APPLIED_EVENT, load);
  }, [load]);
  async function rate(item, rating, detail = {}) {
    const previous = progress[item.id] || {};
    const record = {
      ...previous,
      id: item.id,
      rating,
      attempts: (previous.attempts || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    const event = {
      id: crypto.randomUUID(),
      cardId: item.id,
      category: item.category,
      rating,
      occurredAt: record.updatedAt,
      ...detail,
    };
    await Promise.all([put("cardProgress", record), put("studyEvents", event)]);
    setProgress((old) => ({ ...old, [item.id]: record }));
    setEvents((old) => [...old, event]);
  }
  async function recordQuizAnswer(item, correct, detail = {}) {
    const previous = progress[item.id] || {};
    const now = new Date().toISOString();
    const record = {
      ...previous,
      id: item.id,
      quizAttempts: (previous.quizAttempts || 0) + 1,
      quizCorrect: (previous.quizCorrect || 0) + (correct ? 1 : 0),
      quizWrong: (previous.quizWrong || 0) + (correct ? 0 : 1),
      lastQuizCorrect: correct,
      lastQuizAt: now,
      updatedAt: now,
    };
    const event = {
      id: crypto.randomUUID(),
      cardId: item.id,
      category: item.category,
      type: "quiz",
      rating: correct ? "quiz-correct" : "quiz-wrong",
      quizCorrect: correct,
      occurredAt: now,
      ...detail,
    };
    await Promise.all([put("cardProgress", record), put("studyEvents", event)]);
    setProgress((old) => ({ ...old, [item.id]: record }));
    setEvents((old) => [...old, event]);
  }
  /**
   * Answering a card during daily study.
   *
   * Unlike recordQuizAnswer, this also grades the card: the daily flow is the
   * quiz now, so this is where `rating` comes from. It writes one study event,
   * not one per phase, so the monthly report still counts one answer as one
   * piece of work.
   */
  async function answerStudyCard(item, correct, detail = {}) {
    const previous = progress[item.id] || {};
    const now = new Date().toISOString();
    const { streak, rating } = nextProgressFromAnswer(previous, correct);
    const record = {
      ...previous,
      id: item.id,
      streak,
      rating,
      attempts: (previous.attempts || 0) + 1,
      quizAttempts: (previous.quizAttempts || 0) + 1,
      quizCorrect: (previous.quizCorrect || 0) + (correct ? 1 : 0),
      quizWrong: (previous.quizWrong || 0) + (correct ? 0 : 1),
      lastQuizCorrect: correct,
      lastQuizAt: now,
      updatedAt: now,
    };
    const event = {
      id: crypto.randomUUID(),
      cardId: item.id,
      category: item.category,
      rating,
      streak,
      quizCorrect: correct,
      occurredAt: now,
      ...detail,
    };
    await Promise.all([put("cardProgress", record), put("studyEvents", event)]);
    setProgress((old) => ({ ...old, [item.id]: record }));
    setEvents((old) => [...old, event]);
  }
  // "很熟，別再問我" — skip a word the learner already knows without making them
  // answer it twice.
  async function markKnown(item) {
    const previous = progress[item.id] || {};
    const now = new Date().toISOString();
    const { streak, rating } = markAlreadyKnown();
    const record = { ...previous, id: item.id, streak, rating, updatedAt: now };
    const event = {
      id: crypto.randomUUID(),
      cardId: item.id,
      category: item.category,
      rating,
      streak,
      skipped: true,
      occurredAt: now,
    };
    await Promise.all([put("cardProgress", record), put("studyEvents", event)]);
    setProgress((old) => ({ ...old, [item.id]: record }));
    setEvents((old) => [...old, event]);
  }
  async function saveResult(result) {
    await put("assessmentResults", result);
    setResults((old) => [...old.filter((x) => x.id !== result.id), result]);
  }
  return {
    progress,
    events,
    results,
    ready,
    rate,
    recordQuizAnswer,
    answerStudyCard,
    markKnown,
    saveResult,
    reload: () => location.reload(),
  };
}

function Header({ view, setView, completed, menuOpen, setMenuOpen, drive }) {
  return (
    <>
      <header className="topbar">
        <button className="brand" onClick={() => setView("today")}>
          日語階梯 <span>N3 → N2</span>
        </button>
        <nav>
          {NAV.map(([id, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          className={`account-chip ${drive.status}`}
          onClick={() => setView("settings")}
          title="使用 Google 雲端硬碟同步"
        >
          <i />
          {drive.connected ? "硬碟已連結" : "雲端硬碟"}
        </button>
        <div className="header-progress">
          <strong>{completed}</strong>
          <span>已完成</span>
        </div>
        <button
          className="hamburger"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="開啟選單"
        >
          ☰
        </button>
      </header>
      {menuOpen && (
        <div className="drawer">
          {NAV.map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setView(id);
                setMenuOpen(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function ExampleAudio({ text, settings, label = "例句" }) {
  if (!text) return null;
  return (
    <button
      className="example-audio"
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        speakJapanese(text, settings);
      }}
      aria-label={`播放${label}`}
    >
      ▶ 播放{label}
    </button>
  );
}

function ExampleTranslation({ example }) {
  if (!example?.zh) return null;
  return (
    <div className="example-translation">
      <p>
        <strong>中文翻譯：</strong>
        {example.zh}
      </p>
      {example.explanationZh ? (
        <p>
          <strong>中文解析：</strong>
          {example.explanationZh}
        </p>
      ) : null}
    </div>
  );
}

function DailyPaceCard({ pace, compact = false }) {
  const statusText = pace.beforePlan
    ? "計畫尚未開始"
    : pace.afterPlan
      ? "年度計畫已結束"
      : pace.status === "ahead"
        ? `超前 ${pace.delta} 項`
        : pace.status === "behind"
          ? `落後 ${Math.abs(pace.delta)} 項`
          : "符合進度";
  const guidance = pace.beforePlan
    ? "可以先熟悉操作，正式進度會從 115/07 開始計算。"
    : pace.afterPlan
      ? "已按年度總目標計算，請前往進度成果確認結案完成率。"
      : pace.status === "behind"
        ? `再完成 ${pace.remainingToExpected} 項即可追上今天進度。`
        : pace.status === "ahead"
          ? "目前已超前，可以安排複習或挑戰閱讀聽力。"
          : "今天已達標，保持目前節奏即可。";
  return (
    <section className={`daily-pace ${pace.status} ${compact ? "compact" : ""}`}>
      <div className="daily-pace-head">
        <div>
          <span className="eyebrow">
            DAILY PACE · {formatPeriod(pace.currentPeriod)} · 第 {pace.day}/
            {pace.daysInMonth} 天
          </span>
          <h2>
            實際 {pace.actualTotal.toLocaleString()} / 今日應達{" "}
            {pace.expectedTotal.toLocaleString()}
          </h2>
          <p>
            今日新增目標 {pace.todayTargetTotal} 項。{guidance}
          </p>
        </div>
        <strong className="pace-indicator" aria-label={`學習進度：${statusText}`}>
          {statusText}
        </strong>
      </div>
      <div
        className="daily-pace-bar"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax={Math.max(1, pace.expectedTotal)}
        aria-valuenow={Math.min(pace.actualTotal, pace.expectedTotal)}
      >
        <i style={{ width: `${pace.percent}%` }} />
      </div>
      <div className="daily-pace-grid">
        {pace.categories.map((item) => (
          <article key={item.key}>
            <span>{item.label}</span>
            <strong>
              {item.actual.toLocaleString()} / {item.expected.toLocaleString()}
            </strong>
            <small>今日目標 +{item.todayTarget}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function PeriodRail({ viewPeriod, setViewPeriod, unlockedThrough, data }) {
  const currentIndex = PERIODS.indexOf(unlockedThrough);
  return (
    <aside className="period-rail">
      <div>
        <small>年度路線</small>
        <strong>N3 → N2</strong>
      </div>
      {PERIODS.map((period, i) => {
        const locked = currentIndex >= 0 && i > currentIndex;
        return (
          <button
            key={period}
            disabled={locked}
            className={period === viewPeriod ? "active" : ""}
            onClick={() => !locked && setViewPeriod(period)}
          >
            <span>{formatPeriod(period)}</span>
            <b>{locked ? "鎖定" : i < 6 ? "N3" : "N2"}</b>
          </button>
        );
      })}
      <p>
        目前可學
        <br />
        <strong>
          {data.vocabulary
            .filter((x) => isUnlocked(x, unlockedThrough))
            .length.toLocaleString()}
        </strong>{" "}
        單字
      </p>
    </aside>
  );
}

/**
 * Month switcher for the browsing pages.
 *
 * PeriodRail is hidden below 1050px, which left 教材庫 / 閱讀聽力 / 月檢核與模考
 * with no way to change month at all on a phone. This drives the same
 * `viewPeriod`, so rail and picker stay in step; it is shown at every width
 * rather than mobile-only so the control does not appear out of nowhere.
 */
function PeriodPicker({ viewPeriod, setViewPeriod, unlockedThrough, hint }) {
  const limit = PERIODS.indexOf(unlockedThrough);
  const options = limit < 0 ? PERIODS.slice(0, 1) : PERIODS.slice(0, limit + 1);
  const index = options.indexOf(viewPeriod);
  const selected = index >= 0 ? viewPeriod : options.at(-1);
  const step = (offset) => {
    const next = options[(index >= 0 ? index : options.length - 1) + offset];
    if (next) setViewPeriod(next);
  };
  return (
    <div className="period-picker">
      <label>
        <span>教材月份</span>
        <select
          value={selected}
          onChange={(event) => setViewPeriod(event.target.value)}
        >
          {options.map((period) => (
            <option key={period} value={period}>
              {formatPeriod(period)}
              {period === unlockedThrough ? "（本月）" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="period-step">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={index <= 0}
          aria-label="上一個月份"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={index < 0 || index >= options.length - 1}
          aria-label="下一個月份"
        >
          ›
        </button>
      </div>
      {hint ? <span className="period-hint">{hint}</span> : null}
    </div>
  );
}

// Where to send the surplus. Used twice: by the ahead-of-pace nudge while cards
// are still open, and by the month-complete screen once they are not.
//
// It leads with what each section still owes rather than with a time estimate,
// because that number is the whole argument — "還差 7 題" is a reason to go, and
// "06 分" is not.
function MediaJump({ balance, goMedia }) {
  const line = (owed) =>
    owed > 0 ? `本月還差 ${owed} 題` : "本月已達標，可再練保持手感";
  return (
    <div className="media-jump">
      <button onClick={() => goMedia("reading")}>
        <strong>去做閱讀</strong>
        <small>{line(balance.reading)}</small>
      </button>
      <button onClick={() => goMedia("listening")}>
        <strong>去做聽力</strong>
        <small>{line(balance.listening)}</small>
      </button>
    </div>
  );
}

function MediaShortcuts({ goMedia, unlocked, children }) {
  return (
    <aside className="today-side">
      <h3>接下來</h3>
      <button className="task" onClick={() => goMedia("reading")}>
        <b>08 分</b>
        <span>
          閱讀理解
          <br />
          <small>{unlocked.r[0]?.term || "本月閱讀"}</small>
        </span>
      </button>
      <button className="task" onClick={() => goMedia("listening")}>
        <b>06 分</b>
        <span>
          逐句聽力
          <br />
          <small>{unlocked.l[0]?.term || "本月聽力"}</small>
        </span>
      </button>
      {children}
    </aside>
  );
}

function TodayView({
  data,
  activePeriod,
  today,
  store,
  settings,
  goMedia,
  pageState,
  updatePage,
  dailyPace,
}) {
  const unlocked = useMemo(
    () => ({
      v: data.vocabulary.filter((x) => isUnlocked(x, activePeriod)),
      g: data.grammar.filter((x) => isUnlocked(x, activePeriod)),
      r: data.reading.filter((x) => isUnlocked(x, activePeriod)),
      l: data.listening.filter((x) => isUnlocked(x, activePeriod)),
    }),
    [data, activePeriod],
  );
  const plan = useMemo(
    () =>
      planToday({
        vocabulary: unlocked.v,
        grammar: unlocked.g,
        isMastered: (item) => STRONG_RATINGS.has(store.progress[item.id]?.rating),
        date: today,
      }),
    [unlocked.v, unlocked.g, store.progress, today],
  );
  const { batches, batchIndex, cards, reviewMode, reviewReason } = plan;
  // Read the pace per half rather than as one total: this page only teaches 單字
  // and 文法, so a surplus here is spendable only somewhere else.
  const balance = useMemo(() => studyBalance(dailyPace), [dailyPace]);
  const completedInBatch = cards.filter((item) =>
    STRONG_RATINGS.has(store.progress[item.id]?.rating),
  ).length;
  const [notice, setNotice] = useState("");
  // In review mode each finished round bumps the counter, which changes the key
  // and lets the quiz effect below start a fresh round — the endless loop that
  // runs until Monday raises the weekly cap.
  const reviewRound = Number(pageState.reviewRound) || 0;
  const batchKey = reviewMode
    ? `${activePeriod}:review:${reviewRound}`
    : `${activePeriod}:${batchIndex}`;
  const activeQuiz =
    pageState.quiz?.batchKey === batchKey ? pageState.quiz : null;
  const quizCandidates = useMemo(
    () => [...unlocked.v, ...unlocked.g],
    [unlocked.v, unlocked.g],
  );
  const quizItemsById = useMemo(
    () => new Map(quizCandidates.map((item) => [item.id, item])),
    [quizCandidates],
  );
  // What review mode drills: anything already studied. It used to also include
  // cards merely seen in this batch, which mattered when seeing a card was a
  // separate step from answering it. Answering is the only step now, so having
  // a progress record is the same thing as having met the card.
  const learnedQuizPool = useMemo(
    () => quizCandidates.filter((item) => store.progress[item.id]),
    [quizCandidates, store.progress],
  );
  const previousBatchKey = useRef(batchKey);
  useEffect(() => {
    if (previousBatchKey.current !== batchKey) {
      updatePage((current) => ({
        ...current,
        quiz: null,
      }));
      previousBatchKey.current = batchKey;
    }
  }, [batchKey, updatePage]);
  // The batch is the quiz now. A round asks every card in the batch that has not
  // reached 記得 exactly once — which is what stops a card filling its two-correct
  // streak twice in the same pass — and cards answered wrong simply reappear in
  // the next round, so there is no separate re-queue to keep in step.
  useEffect(() => {
    if (reviewMode || !cards.length || activeQuiz) return;
    const outstanding = roundCards(cards, store.progress);
    if (!outstanding.length) return;
    const questions = outstanding
      .map((item) => buildQuizQuestion(item, quizCandidates))
      .filter((question) => question.options.length >= 2);
    if (!questions.length) return;
    updatePage((current) => {
      if (current.quiz?.batchKey === batchKey) return current;
      return {
        ...current,
        quiz: {
          id: crypto.randomUUID(),
          batchKey,
          questions,
          current: 0,
          answers: {},
          startedAt: new Date().toISOString(),
        },
      };
    });
  }, [
    activeQuiz,
    batchKey,
    cards,
    quizCandidates,
    reviewMode,
    store.progress,
    updatePage,
  ]);
  // Review mode has no cards to reveal, so the quiz starts straight away and a
  // new round begins as soon as the previous one is finished.
  useEffect(() => {
    if (!reviewMode || activeQuiz) return;
    const questions = buildStudyQuiz({
      pool: learnedQuizPool.length ? learnedQuizPool : quizCandidates,
      allCandidates: quizCandidates,
      progress: store.progress,
      recentQuizRounds: pageState.recentQuizRounds || [],
    });
    if (!questions.length) return;
    updatePage((current) => {
      if (current.quiz?.batchKey === batchKey) return current;
      return {
        ...current,
        quiz: {
          id: crypto.randomUUID(),
          batchKey,
          questions,
          current: 0,
          answers: {},
          startedAt: new Date().toISOString(),
        },
      };
    });
  }, [
    reviewMode,
    activeQuiz,
    batchKey,
    learnedQuizPool,
    pageState.recentQuizRounds,
    quizCandidates,
    store.progress,
    updatePage,
  ]);
  const answerQuiz = useCallback(
    async (selectedIndex) => {
      const quiz = pageState.quiz;
      const currentIndex = quiz?.current || 0;
      const question = quiz?.questions?.[currentIndex];
      if (!question || quiz.answers?.[currentIndex]) return;
      const correct = selectedIndex === question.correctIndex;
      const answeredAt = new Date().toISOString();
      // The same pure rule the store is about to apply, so the panel can tell
      // the learner whether this answer finished the card or got it halfway.
      const { streak: resultStreak } = nextProgressFromAnswer(
        store.progress[question.itemId],
        correct,
      );
      updatePage((current) => {
        if (current.quiz?.id !== quiz.id) return current;
        return {
          ...current,
          quiz: {
            ...current.quiz,
            answers: {
              ...(current.quiz.answers || {}),
              [currentIndex]: { selectedIndex, correct, answeredAt, streak: resultStreak },
            },
          },
        };
      });
      const item = quizItemsById.get(question.itemId);
      if (item) {
        // Daily study grades the card — this is where `rating` now comes from.
        // Review mode is drilling material already mastered, so it only records
        // the attempt and must not be able to knock a card back down.
        const record = reviewMode ? store.recordQuizAnswer : store.answerStudyCard;
        await record(item, correct, {
          selectedOption: question.options[selectedIndex],
          correctOption: question.correctMeaning,
          quizRoundId: quiz.id,
          quizQuestion: currentIndex + 1,
          dailyBatch: reviewMode ? undefined : batchIndex + 1,
          unlockPeriod: activePeriod,
        });
      }
    },
    [
      activePeriod,
      batchIndex,
      pageState.quiz,
      quizItemsById,
      reviewMode,
      store,
      updatePage,
    ],
  );
  const nextQuizQuestion = useCallback(() => {
    updatePage((current) => {
      if (!current.quiz) return current;
      const maxIndex = Math.max(0, (current.quiz.questions || []).length - 1);
      return {
        ...current,
        quiz: {
          ...current.quiz,
          current: Math.min((current.quiz.current || 0) + 1, maxIndex),
        },
      };
    });
  }, [updatePage]);
  const finishQuiz = useCallback(() => {
    updatePage((current) => {
      const itemIds = current.quiz?.questions?.map((question) => question.itemId);
      return {
        ...current,
        // Clearing the round lets the effect build the next one from whatever is
        // still outstanding — which is how a card answered wrong comes back.
        quiz: null,
        // Bumping the round is what makes review mode loop: the key changes, so
        // the effect above immediately builds the next set of questions.
        reviewRound: reviewMode
          ? (Number(current.reviewRound) || 0) + 1
          : current.reviewRound,
        recentQuizRounds: rememberQuizRound(
          current.recentQuizRounds || [],
          itemIds || [],
        ),
      };
    });
  }, [batchKey, reviewMode, updatePage]);
  // The unlock notice used to be raised by the rating buttons. Answering masters
  // a card now, so it is raised by the batch pointer moving on.
  //
  // It cannot be derived from "the current batch has nothing outstanding":
  // mastering the last card advances `batchIndex` in the same render, so `cards`
  // is already the next batch by the time anything could look at it.
  const seenBatchIndex = useRef(batchIndex);
  useEffect(() => {
    if (batchIndex <= seenBatchIndex.current) {
      seenBatchIndex.current = batchIndex;
      return;
    }
    seenBatchIndex.current = batchIndex;
    const hasNextBatch = Boolean(batches[batchIndex]?.length);
    const withinWeeklyCap = batchIndex < plan.allowedBatches;
    setNotice(
      hasNextBatch && withinWeeklyCap
        ? `上一批全部答對兩次，已自動開放第 ${batchIndex + 1} 批新內容。`
        : hasNextBatch
          ? "本批完成，但已達本週開放上限；先進入複習模式，下週一自動開放新進度。"
          : "本月單字與文法進度完成，去學學閱讀聽力吧！",
    );
  }, [batchIndex, batches, plan.allowedBatches]);
  if (!cards.length) {
    const nextUnlock = plan.nextUnlockAt;
    const nextUnlockText = `${nextUnlock.getMonth() + 1} 月 ${nextUnlock.getDate()} 日（週一）`;
    // The month's cards are done and nothing more opens until the next period
    // starts — a different wait from the weekly cap's, and a much longer one, so
    // it gets its own date and its own instruction.
    const monthDone = reviewReason === "month";
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const nextMonthText = `${nextMonth.getMonth() + 1} 月 ${nextMonth.getDate()} 日`;
    return (
      <section className="today-view">
        <div className="page-intro">
          <div>
            <span className="eyebrow">
              TODAY · {formatPeriod(activePeriod)} ·{" "}
              {monthDone ? "本月完成" : `複習第 ${reviewRound + 1} 輪`}
            </span>
            <h1>
              {monthDone
                ? "本月單字與文法進度完成，去學學閱讀聽力吧。"
                : "本週的新教材已全部開放。"}
            </h1>
            <p>
              {monthDone
                ? // Kept short on purpose: the card below carries the dates and
                  // the numbers, and this paragraph sits right above it.
                  "這個月的單字與文法都達標了。剩下的時間交給閱讀和聽力 —— 檢定的四個科目是分開計分的，另外兩科不會因為卡片背得多而變好。"
                : `每週上限為 ${plan.allowance.vocabulary} 個單字、${plan.allowance.grammar} 條文法（累計至第 ${plan.allowance.week} 週）。接下來進入複習模式，小測驗會一輪接一輪，直到 ${nextUnlockText} 自動開放新進度。`}
            </p>
          </div>
          <div className="today-ring">
            {monthDone ? (
              <>
                <strong>{balance.mediaOwed}</strong>
                <span>題</span>
                <small>閱讀聽力待做</small>
              </>
            ) : (
              <>
                <strong>{reviewRound + 1}</strong>
                <span>輪</span>
                <small>複習中</small>
              </>
            )}
          </div>
        </div>
        <DailyPaceCard pace={dailyPace} />
        {/* Not in the page intro, deliberately. `.today-view .page-intro p` is
            display:none on phones — the header there is cut down to a headline
            and the ring — and the intro's first column is narrowed by that ring
            anyway. A card in the flow keeps both the sentence and the buttons
            at full width on the screen this matters most on. */}
        {monthDone ? (
          <div className="week-card pace-nudge" role="status">
            <span>下個月才開放</span>
            <strong>本月的單字與文法已全部完成</strong>
            <p>
              {nextMonthText}才會放出下個月的新卡，這個月不會再有新的單字文法。
              {balance.mediaOwed > 0
                ? `現在還推得動的只剩閱讀聽力：閱讀還差 ${balance.reading} 題、聽力還差 ${balance.listening} 題。`
                : "閱讀與聽力也都達標了，接下來用複習和模考保持手感就好。"}
            </p>
            <MediaJump balance={balance} goMedia={goMedia} />
          </div>
        ) : (
          <div className="week-card unlock-notice" role="status">
            ↻ 複習模式：{nextUnlockText} 自動開放新教材
          </div>
        )}
        <div className="dashboard-grid">
          {activeQuiz ? (
            <StudyQuizPanel
              quiz={activeQuiz}
              settings={settings}
              cardsById={quizItemsById}
              reviewMode
              onAnswer={answerQuiz}
              onNext={nextQuizQuestion}
              onFinish={finishQuiz}
            />
          ) : (
            <Empty text="正在準備下一輪小測驗…" />
          )}
          <MediaShortcuts goMedia={goMedia} unlocked={unlocked} />
        </div>
      </section>
    );
  }
  return (
    <section className="today-view">
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            TODAY · {formatPeriod(activePeriod)} · 第 {batchIndex + 1} 批
          </span>
          <h1>把零碎時間，疊成日語實力。</h1>
          <p>
            本批 6 個單字、3
            個文法；全部標為「記得」或「很熟」後，自動開放下一批。
          </p>
        </div>
        <div className="today-ring">
          <strong>{completedInBatch}</strong>
          <span>/ {cards.length}</span>
          <small>本批達標</small>
        </div>
      </div>
      <DailyPaceCard pace={dailyPace} />
      {notice && (
        <div className="week-card unlock-notice" role="status">
          ✓ {notice}
        </div>
      )}
      {balance.suggestMedia && (
        <div className="week-card pace-nudge" role="status">
          <span>建議</span>
          <strong>
            單字文法已超前 {balance.cardsDelta} 項
            {balance.daysAhead >= 1 ? `（約 ${balance.daysAhead} 天份）` : ""}
          </strong>
          <p>
            這一批可以照常做完，但今天多出來的時間換到閱讀聽力更划算 ——
            閱讀還差 {balance.reading} 題、聽力還差 {balance.listening}{" "}
            題，而檢定四個科目是分開計分的。
          </p>
          <MediaJump balance={balance} goMedia={goMedia} />
        </div>
      )}
      <div className="dashboard-grid">
        {activeQuiz ? (
          <StudyQuizPanel
            quiz={activeQuiz}
            settings={settings}
            cardsById={quizItemsById}
            reviewMode={reviewMode}
            outstanding={reviewMode ? 0 : roundCards(cards, store.progress).length}
            onAnswer={answerQuiz}
            onNext={nextQuizQuestion}
            onFinish={finishQuiz}
            onKnown={
              reviewMode
                ? null
                : (itemId) => {
                    const item = quizItemsById.get(itemId);
                    if (item) void store.markKnown(item);
                  }
            }
          />
        ) : (
          <div className="lesson-card batch-done">
            <div className="lesson-top">
              <span>本批完成</span>
            </div>
            <div className="batch-done-main">
              <strong>這一批都答對兩次了</strong>
              <p>正在開放下一批…</p>
            </div>
          </div>
        )}
        <MediaShortcuts goMedia={goMedia} unlocked={unlocked}>
          <div className="week-card">
            <span>自動解鎖</span>
            <strong>
              {completedInBatch} / {cards.length} 張達標
            </strong>
            <p>
              本批全部達到「記得」以上就立即開放下一批，直到用完本週上限
              {plan.allowance.vocabulary} 個單字、{plan.allowance.grammar} 條文法。
            </p>
          </div>
        </MediaShortcuts>
      </div>
    </section>
  );
}

function LibraryView({
  data,
  activePeriod,
  setViewPeriod,
  unlockedThrough,
  store,
  settings,
  pageState,
  updatePage,
}) {
  const query = pageState.query || "";
  const type = pageState.type || "vocabulary";
  const onlyWeak = Boolean(pageState.onlyWeak);
  const pageSize = LIBRARY_PAGE_SIZES.includes(Number(pageState.pageSize))
    ? Number(pageState.pageSize)
    : 30;
  const filteredItems = useMemo(
    () =>
      data[type]
        .filter((x) => isUnlocked(x, activePeriod))
        .filter((x) => !onlyWeak || store.progress[x.id]?.rating === "hard")
        .filter((x) =>
          `${x.term}${x.reading}${x.meaningZh}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
    [data, type, query, onlyWeak, store.progress, activePeriod],
  );
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(
    Math.max(Number(pageState.page) || 1, 1),
    totalPages,
  );
  const pageStart = filteredItems.length ? (currentPage - 1) * pageSize : 0;
  const items = useMemo(
    () => filteredItems.slice(pageStart, pageStart + pageSize),
    [filteredItems, pageStart, pageSize],
  );
  const pageEnd = Math.min(pageStart + items.length, filteredItems.length);
  const updateLibraryFilter = useCallback(
    (changes) =>
      updatePage((current) => ({
        ...current,
        ...changes,
        page: 1,
      })),
    [updatePage],
  );
  const goToPage = useCallback(
    (page) =>
      updatePage((current) => ({
        ...current,
        page: Math.min(Math.max(page, 1), totalPages),
      })),
    [updatePage, totalPages],
  );
  return (
    <section>
      <PageTitle
        eyebrow="LIBRARY"
        title="教材庫"
        text="搜尋、播放與重練目前已解鎖的教材。"
      />
      <PeriodPicker
        viewPeriod={activePeriod}
        setViewPeriod={setViewPeriod}
        unlockedThrough={unlockedThrough}
        hint={`本月共 ${(data[type] || []).filter((x) => x.unlockPeriod === activePeriod).length.toLocaleString()} 項新教材`}
      />
      <aside className="reference-panel" role="note">
        <strong>教材修訂原則</strong>
        <span>
          N3／N2 分級、主題與文法接續交叉參考
          <a href="https://www.sigure.tw/" target="_blank" rel="noreferrer">
            時雨之町
          </a>
          ；中文說明、例句與題目均重新編寫，不轉載原文。
        </span>
      </aside>
      <div className="toolbar">
        <input
          value={query}
          onChange={(e) => updateLibraryFilter({ query: e.target.value })}
          placeholder="搜尋單字、讀音或中文意思"
        />
        <select
          value={type}
          onChange={(e) => updateLibraryFilter({ type: e.target.value })}
        >
          <option value="vocabulary">單字</option>
          <option value="grammar">文法</option>
        </select>
        <select
          value={pageSize}
          aria-label="每頁顯示筆數"
          onChange={(e) =>
            updateLibraryFilter({ pageSize: Number(e.target.value) })
          }
        >
          {LIBRARY_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              每頁 {size} 筆
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={onlyWeak}
            onChange={(e) =>
              updateLibraryFilter({
                onlyWeak: e.target.checked,
              })
            }
          />{" "}
          只看錯題
        </label>
      </div>
      <LibraryPagination
        total={filteredItems.length}
        pageStart={pageStart}
        pageEnd={pageEnd}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={goToPage}
      />
      <div className="library-list">
        {items.map((item) => (
          <article key={item.id}>
            <span className="level-pill">{item.level}</span>
            <div>
              <h3>
                {item.term} <small>{item.reading}</small>
              </h3>
              <p>{item.meaningZh}</p>
              <small className="library-usage">{item.usageZh}</small>
              <details className="library-example">
                <summary>查看例句</summary>
                <p lang="ja">{item.examples?.[0]?.ja}</p>
                <ExampleAudio
                  text={item.examples?.[0]?.ja}
                  settings={settings}
                />
                <ExampleTranslation example={item.examples?.[0]} />
              </details>
            </div>
            <button
              onClick={() => speakJapanese(item.audioText, settings)}
              aria-label={`播放${item.term}`}
            >
              ▶
            </button>
            <b className={store.progress[item.id]?.rating || "new"}>
              {store.progress[item.id]?.rating || "未學"}
            </b>
          </article>
        ))}
      </div>
      {!filteredItems.length && <Empty text="沒有符合條件的教材。" />}
      {filteredItems.length > pageSize && (
        <LibraryPagination
          total={filteredItems.length}
          pageStart={pageStart}
          pageEnd={pageEnd}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={goToPage}
          compact
        />
      )}
    </section>
  );
}

function LibraryPagination({
  total,
  pageStart,
  pageEnd,
  currentPage,
  totalPages,
  onPageChange,
  compact = false,
}) {
  if (!total) {
    return (
      <div className="library-pagination">
        <span>共 0 筆教材</span>
      </div>
    );
  }

  return (
    <nav
      className={`library-pagination${compact ? " compact" : ""}`}
      aria-label="教材庫分頁"
    >
      <span>
        顯示 {pageStart + 1}–{pageEnd}／共 {total} 筆
      </span>
      <div>
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
        >
          第一頁
        </button>
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
        >
          上一頁
        </button>
        <strong>
          {currentPage} / {totalPages}
        </strong>
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
        >
          下一頁
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
        >
          最後頁
        </button>
      </div>
    </nav>
  );
}

/**
 * The 文字・語彙 and 文法 practice sets.
 *
 * A worksheet rather than the one-item-at-a-time layout reading and listening
 * use: these questions are short and self-contained, so scrolling a month's set
 * is faster than paging through it.
 *
 * Answers are deliberately not graded. Practice must not be a second route to
 * unlocking new material — that is what the daily rounds are for — so nothing
 * here touches cardProgress, and the answers live in page state only.
 */
function PracticePanel({ items, answers, onAnswer, settings }) {
  if (!items.length) {
    return <Empty text="這個月份尚無練習題，請切換到其他月份。" />;
  }
  const answered = items.filter((item) => answers[item.id] !== undefined).length;
  const correct = items.filter(
    (item) => answers[item.id] === item.answer,
  ).length;
  return (
    <div className="practice-list">
      <p className="lesson-list-head">
        共 {items.length} 題 · 已作答 {answered} · 答對 {correct}
        <span className="practice-note">（練習不計入學習進度）</span>
      </p>
      {items.map((item, index) => {
        const chosen = answers[item.id];
        return (
          <article className="practice-item" key={item.id}>
            <div className="question-meta">
              <span>{item.section}</span>
              <b>{item.type}</b>
            </div>
            <p className="exam-instruction">{item.instruction}</p>
            <p className="exam-passage" lang="ja">
              {item.passage}
              <ExampleAudio
                text={item.passage.replace(/[＿（）　]/g, "")}
                settings={settings}
              />
            </p>
            <h3>
              {index + 1}. {item.prompt}
            </h3>
            {item.options.map((option, optionIndex) => {
              const isChosen = chosen === optionIndex;
              const isCorrect = item.answer === optionIndex;
              const state =
                chosen === undefined
                  ? ""
                  : isCorrect
                    ? "correct"
                    : isChosen
                      ? "wrong"
                      : "";
              return (
                <button
                  key={option}
                  className={state}
                  disabled={chosen !== undefined}
                  onClick={() => onAnswer(item.id, optionIndex)}
                >
                  {String.fromCharCode(65 + optionIndex)}. {option}
                </button>
              );
            })}
            {chosen !== undefined && (
              <p className="explanation">
                {chosen === item.answer ? "答對了。" : "再看一次句子。"}{" "}
                {item.explanationZh}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

function MediaView({
  data,
  activePeriod,
  setViewPeriod,
  unlockedThrough,
  settings,
  store,
  pageState,
  updatePage,
}) {
  const type = pageState.type || "reading";
  // That month's own material, not everything unlocked up to it. Cumulative
  // meant the list grew every month and the current month's items sat at the
  // bottom, so "switch month" barely changed what was on screen.
  // 文字・語彙 and 文法 practice live in the same page because the exam has four
  // sections and this page only ever covered two of them.
  const practiceSection = { vocab: "文字・語彙", grammar: "文法" }[type];
  const monthPractice = (data.practice || []).filter(
    (x) => x.unlockPeriod === activePeriod,
  );
  const practiceItems = practiceSection
    ? monthPractice.filter((x) => x.section === practiceSection)
    : [];
  const list = practiceSection
    ? []
    : data[type].filter((x) => x.unlockPeriod === activePeriod);
  const counts = {
    vocab: monthPractice.filter((x) => x.section === "文字・語彙").length,
    grammar: monthPractice.filter((x) => x.section === "文法").length,
    reading: data.reading.filter((x) => x.unlockPeriod === activePeriod).length,
    listening: data.listening.filter((x) => x.unlockPeriod === activePeriod)
      .length,
  };
  // Answered means every question of the item has been answered: that is when
  // the item gets rated, and the rating says whether they were all correct.
  const answeredState = (item) => {
    const rating = store.progress[item.id]?.rating;
    if (!rating) return null;
    return rating === "good" ? "correct" : "partial";
  };
  const answeredCount = list.filter((x) => answeredState(x)).length;
  const rawSelected = Number(pageState.selected) || 0;
  const selected = list.length
    ? ((rawSelected % list.length) + list.length) % list.length
    : 0;
  const item = list[selected];
  const transcript = Boolean(pageState.transcript);
  // Answers are keyed by question id, not item id: a 長文 carries three questions
  // and a 統合理解 conversation two, so one slot per item lost all but the first.
  const answers = pageState.answers || {};
  const replays = Number(pageState.replays) || 0;
  const startedAt = pageState.startedAt ? Number(pageState.startedAt) : null;
  const elapsedBase = Number(pageState.elapsed) || 0;
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setClock(Date.now());
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const previousPeriod = useRef(activePeriod);
  useEffect(() => {
    if (previousPeriod.current !== activePeriod) {
      updatePage((current) => ({
        ...current,
        selected: 0,
        answer: null,
        transcript: false,
        replays: 0,
        elapsed: 0,
        startedAt: null,
      }));
      previousPeriod.current = activePeriod;
    }
  }, [activePeriod, updatePage]);
  const elapsed =
    elapsedBase +
    (startedAt ? Math.max(0, Math.floor((clock - startedAt) / 1000)) : 0);
  const readingCount = data.reading.filter((x) =>
    isUnlocked(x, activePeriod),
  ).length;
  const listeningCount = data.listening.filter((x) =>
    isUnlocked(x, activePeriod),
  ).length;
  // Declared above the early returns: the section tabs live in the header, and
  // the practice branch returns before this point, which left the tab handlers
  // reaching a const that had not been initialised in that render.
  const selectType = (nextType) =>
    updatePage((current) => ({
      ...current,
      type: nextType,
      selected: 0,
      answer: null,
      transcript: false,
      replays: 0,
      elapsed: 0,
      startedAt: null,
    }));

  // The header carries the month switcher and the section tabs, so both have to
  // render even when the chosen section is empty — otherwise the learner lands
  // on a dead end with no way back.
  const tabs = (
    <div className="segmented four-up">
      {[
        ["vocab", "文字・語彙"],
        ["grammar", "文法"],
        ["reading", "閱讀"],
        ["listening", "聽力"],
      ].map(([key, label]) => (
        <button
          key={key}
          className={type === key ? "active" : ""}
          onClick={() => selectType(key)}
        >
          {label} {counts[key]}
        </button>
      ))}
    </div>
  );
  const header = (
    <>
      <PageTitle
        eyebrow="PRACTICE"
        title="分科練習"
        text="依日檢四個科目分開練習；文字・語彙與文法為隨堂練習，不計入學習進度。"
      />
      <PeriodPicker
        viewPeriod={activePeriod}
        setViewPeriod={setViewPeriod}
        unlockedThrough={unlockedThrough}
        hint={`本月 文字・語彙 ${counts.vocab} · 文法 ${counts.grammar} · 閱讀 ${counts.reading} · 聽力 ${counts.listening}`}
      />
      {tabs}
    </>
  );
  if (practiceSection)
    return (
      <section>
        {header}
        <PracticePanel
          items={practiceItems}
          answers={pageState.practiceAnswers || {}}
          settings={settings}
          onAnswer={(id, choice) =>
            updatePage((current) => ({
              ...current,
              practiceAnswers: {
                ...(current.practiceAnswers || {}),
                [id]: choice,
              },
            }))
          }
        />
      </section>
    );
  if (!item)
    return (
      <section>
        {header}
        <Empty text="這個月份尚無閱讀／聽力教材，請切換到其他月份。" />
      </section>
    );
  // 概要理解 and 統合理解 print no question in advance in the real exam — you
  // listen first, then find out what was asked. Showing the stem up front would
  // remove the skill the 大問 exists to test.
  const questionsHidden =
    item.revealQuestionFirst === false && !pageState.revealed?.[item.id];
  const revealQuestions = () =>
    updatePage((current) => ({
      ...current,
      revealed: { ...(current.revealed || {}), [item.id]: true },
    }));
  const answerQuestion = (question, choice) => {
    const nextAnswers = { ...answers, [question.id]: choice };
    updatePage((current) => ({
      ...current,
      answers: { ...(current.answers || {}), [question.id]: choice },
    }));
    // Rate the item once, when its last question is answered, so a three-question
    // 長文 logs one study event rather than three.
    const done = item.questions.every((q) => nextAnswers[q.id] !== undefined);
    if (!done) return;
    const allCorrect = item.questions.every(
      (q) => nextAnswers[q.id] === q.answer,
    );
    store.rate(item, allCorrect ? "good" : "hard", { replays });
  };
  const goToMediaItem = (nextIndex) =>
    updatePage((current) => ({
      ...current,
      selected: (nextIndex + list.length) % list.length,
      transcript: false,
      replays: 0,
      elapsed: 0,
      startedAt: null,
    }));
  const replay = (text) => {
    speakJapanese(text, settings);
    updatePage((current) => ({
      ...current,
      replays: (Number(current.replays) || 0) + 1,
    }));
  };
  const toggleTimer = () =>
    updatePage((current) =>
      current.startedAt
        ? { ...current, elapsed, startedAt: null }
        : { ...current, startedAt: Date.now() },
    );
  return (
    <section>
      {header}
      <div className="media-layout">
        <aside className="lesson-list">
          <p className="lesson-list-head">
            {formatPeriod(activePeriod)} · 共 {list.length} 題 · 已作答{" "}
            {answeredCount}
          </p>
          {list.map((x, i) => {
            const answered = answeredState(x);
            return (
              <button
                key={x.id}
                className={`${i === selected ? "active" : ""}${
                  answered ? ` answered ${answered}` : ""
                }`}
                onClick={() =>
                  updatePage((current) => ({
                    ...current,
                    selected: i,
                    transcript: false,
                    replays: 0,
                  }))
                }
              >
                <b>{String(i + 1).padStart(2, "0")}</b>
                <span>
                  {x.term}
                  <small>
                    {x.estimatedMinutes} 分鐘 · 難度 {x.difficulty}
                  </small>
                </span>
                {answered ? (
                  <i
                    className="answered-mark"
                    title={answered === "correct" ? "已作答，全對" : "已作答，有錯"}
                  >
                    {answered === "correct" ? "✓" : "!"}
                  </i>
                ) : null}
              </button>
            );
          })}
        </aside>
        <article className="media-workspace">
          <div className="media-head">
            <div>
              <div className="news-meta">
                <span>
                  {item.level} · <b className="jlpt-badge">{item.jlptType}</b>
                  {item.reading ? ` · ${item.reading}` : ""}
                </span>
                <time>{item.dateline}</time>
              </div>
              <h2>
                {item.headline || item.term}
                {answeredState(item) ? (
                  <span className={`answered-tag ${answeredState(item)}`}>
                    {answeredState(item) === "correct" ? "已作答 · 全對" : "已作答 · 有錯"}
                  </span>
                ) : null}
              </h2>
              {item.meaningZh ? (
                <p className="format-hint">{item.meaningZh}</p>
              ) : null}
            </div>
            <div className="timer">
              {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
              {String(elapsed % 60).padStart(2, "0")}
              <button onClick={toggleTimer}>
                {startedAt ? "暫停" : "計時"}
              </button>
            </div>
          </div>
          {type === "reading" ? (
            <div className="reading-copy">
              <article
                className={`news-article${item.infoRows ? " info-table" : ""}`}
              >
                {item.content.split("\n").map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </article>
              {item.sourceNoteZh ? (
                <aside className="source-note">
                  <strong>編寫說明：</strong>
                  {item.sourceNoteZh}
                  {item.sourceRefs
                    ?.filter((ref) => ref.startsWith("http"))
                    .map((ref) => (
                      <a key={ref} href={ref} target="_blank" rel="noreferrer">
                        參考頁
                      </a>
                    ))}
                </aside>
              ) : null}
              <textarea
                value={pageState.summaries?.[item.id] || ""}
                onChange={(event) =>
                  updatePage((current) => ({
                    ...current,
                    summaries: {
                      ...(current.summaries || {}),
                      [item.id]: event.target.value,
                    },
                  }))
                }
                placeholder={item.summaryPromptZh || "用 2–3 句寫下摘要…"}
              />
            </div>
          ) : (
            <div className="listening-player">
              <button
                className="play-big"
                onClick={() => replay(item.audioText)}
              >
                ▶
              </button>
              <div>
                <strong>完整播放</strong>
                <p>
                  速度 {settings.rate}× · 已重播 {replays} 次
                </p>
              </div>
              <button onClick={stopSpeech}>停止</button>
              <div className="line-buttons">
                {item.lines.map((line, i) => (
                  <button key={i} onClick={() => replay(line)}>
                    第 {i + 1} 句 ▶
                  </button>
                ))}
              </div>
              <button
                className="text-button"
                onClick={() =>
                  updatePage((current) => ({
                    ...current,
                    transcript: !current.transcript,
                  }))
                }
              >
                {transcript ? "隱藏" : "顯示"}聽力稿
              </button>
              {transcript && (
                <div className="transcript">
                  {item.lines.map((x, i) => (
                    <p key={i}>{x}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          {questionsHidden ? (
            <div className="question question-hidden">
              <p>
                這是「{item.jlptType}」，正式考試不會事先給題目。
                請先聽完，再看問題。
              </p>
              <button type="button" onClick={revealQuestions}>
                聽完了，顯示問題
              </button>
            </div>
          ) : (
            item.questions.map((question, qi) => {
              const answer = answers[question.id] ?? null;
              return (
                <div className="question" key={question.id}>
                  <h3>
                    {item.questions.length > 1 && (
                      <span className="question-number">問{qi + 1}</span>
                    )}
                    {question.prompt}
                  </h3>
                  {question.options.map((option, i) => (
                    <button
                      key={option}
                      className={
                        answer === i
                          ? i === question.answer
                            ? "correct"
                            : "wrong"
                          : ""
                      }
                      onClick={() => answerQuestion(question, i)}
                    >
                      {String.fromCharCode(65 + i)}. {option}
                    </button>
                  ))}
                  {answer !== null && (
                    <p className="explanation">
                      {answer === question.answer
                        ? "答對了。"
                        : type === "reading"
                          ? "再讀一次關鍵句。"
                          : "再聽一次關鍵句。"}{" "}
                      {question.explanation}
                    </p>
                  )}
                </div>
              );
            })
          )}
          <div className="media-nav-actions" aria-label="閱讀聽力上下題">
            <button
              type="button"
              disabled={list.length <= 1}
              onClick={() => goToMediaItem(selected - 1)}
            >
              ← 上一題
            </button>
            <span>
              {selected + 1} / {list.length}
            </span>
            <button
              type="button"
              disabled={list.length <= 1}
              onClick={() => goToMediaItem(selected + 1)}
            >
              下一題 →
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}

function ExamAnswerCard({
  questions,
  answers,
  mode = "practice",
  onJump,
  currentIndex = null,
  statusPrefix = "exam-status",
  answeredCount,
  totalQuestions,
  unansweredCount,
}) {
  const resultStats = mode === "review"
    ? questions.reduce(
        (stats, question, index) => {
          if (answers[index] === question.answer) stats.correct += 1;
          else stats.wrong += 1;
          return stats;
        },
        { correct: 0, wrong: 0 },
      )
    : null;
  return (
    <aside
      className={`exam-answer-card ${mode === "review" ? "is-review" : ""}`}
      aria-label={mode === "review" ? "成績答題卡" : "答題卡"}
    >
      <div className="answer-card-head">
        <div>
          <span className="eyebrow">ANSWER CARD</span>
          <h3>{mode === "review" ? "成績答題卡" : "答題卡"}</h3>
        </div>
        <strong>共 {totalQuestions} 題</strong>
      </div>
      <div className="answer-card-stats">
        {mode === "review" ? (
          <>
            <article>
              <span>正確</span>
              <strong>{resultStats.correct}</strong>
            </article>
            <article>
              <span>錯誤</span>
              <strong>{resultStats.wrong}</strong>
            </article>
            <article>
              <span>總題數</span>
              <strong>{totalQuestions}</strong>
            </article>
          </>
        ) : (
          <>
            <article>
              <span>已答題</span>
              <strong>{answeredCount}</strong>
            </article>
            <article>
              <span>未答題</span>
              <strong>{unansweredCount}</strong>
            </article>
            <article>
              <span>總題數</span>
              <strong>{totalQuestions}</strong>
            </article>
          </>
        )}
      </div>
      <div className="answer-card-grid">
        {questions.map((question, index) => {
          const hasAnswer = answers[index] !== undefined;
          const correct = answers[index] === question.answer;
          const status =
            mode === "review"
              ? correct
                ? "correct"
                : "wrong"
              : hasAnswer
                ? "answered"
                : "unanswered";
          return (
            <button
              key={question.id}
              id={`${statusPrefix}-${index + 1}`}
              type="button"
              className={`${status} ${currentIndex === index ? "current" : ""}`}
              aria-current={currentIndex === index ? "true" : undefined}
              onClick={() => onJump?.(index)}
              aria-label={`第 ${index + 1} 題，${
                mode === "review"
                  ? correct
                    ? "正確"
                    : "錯誤"
                  : hasAnswer
                    ? "已答"
                    : "未答"
              }`}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
      <div className="answer-card-legend">
        {mode === "review" ? (
          <>
            <span>
              <i className="correct" /> 正確
            </span>
            <span>
              <i className="wrong" /> 錯誤
            </span>
          </>
        ) : (
          <>
            <span>
              <i className="answered" /> 已答
            </span>
            <span>
              <i className="unanswered" /> 未答
            </span>
          </>
        )}
      </div>
    </aside>
  );
}

function MockView({
  data,
  activePeriod,
  setViewPeriod,
  unlockedThrough,
  store,
  settings,
  pageState,
  updatePage,
}) {
  const list = data.assessments.filter((x) => isUnlocked(x, activePeriod));
  const exam = data.assessments.find((item) => item.id === pageState.examId);
  const answers = pageState.answers || {};
  const review = pageState.review;
  const reviewExam = data.assessments.find(
    (item) => item.id === review?.examId,
  );
  const questions = exam?.questions || [];
  const answeredCount = Object.keys(answers).length;
  const totalQuestions = questions.length;
  const unansweredCount = Math.max(0, totalQuestions - answeredCount);
  const startedAt = pageState.startedAt ? Number(pageState.startedAt) : null;
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setClock(Date.now());
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  useEffect(() => {
    setCurrentQuestionIndex(0);
  }, [exam?.id, review?.examId]);
  const seconds = startedAt
    ? Math.max(0, Math.floor((clock - startedAt) / 1000))
    : Number(review?.seconds) || 0;
  function scrollToMobileAnswerStatus(index, prefix = "practice-answer") {
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    requestAnimationFrame(() => {
      document
        .getElementById(`${prefix}-${index + 1}`)
        ?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
    });
  }
  function scrollToQuestion(index) {
    setCurrentQuestionIndex(index);
    scrollToMobileAnswerStatus(index);
    document
      .getElementById(`exam-question-${index + 1}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function scrollToReviewQuestion(index) {
    setCurrentQuestionIndex(index);
    scrollToMobileAnswerStatus(index, "review-answer");
    document
      .getElementById(`review-question-${index + 1}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function answerQuestion(index, optionIndex) {
    setCurrentQuestionIndex(index);
    updatePage((current) => ({
      ...current,
      answers: {
        ...(current.answers || {}),
        [index]: optionIndex,
      },
    }));
    scrollToMobileAnswerStatus(index);
  }
  async function finish() {
    if (
      answeredCount < questions.length &&
      !window.confirm(
        `還有 ${questions.length - answeredCount} 題尚未作答，確定要提前交卷嗎？`,
      )
    )
      return;
    const correct = questions.filter(
      (question, index) => answers[index] === question.answer,
    ).length;
    const score = Math.round((correct / questions.length) * 100);
    const finishedSeconds = seconds;
    await store.saveResult({
      id: `${exam.id}-${Date.now()}`,
      assessmentId: exam.id,
      title: exam.title,
      score,
      seconds: finishedSeconds,
      answeredCount,
      answers,
      submittedEarly: answeredCount < questions.length,
      completedAt: new Date().toISOString(),
    });
    updatePage((current) => ({
      ...current,
      examId: null,
      answers: {},
      startedAt: null,
      review: { examId: exam.id, answers, score, seconds: finishedSeconds },
      scrollY: 0,
    }));
    window.scrollTo(0, 0);
  }
  function cancelExam() {
    if (
      answeredCount > 0 &&
      !window.confirm("確定要取消本次作答嗎？目前答案會被清除，且不會留下成績。")
    )
      return;
    updatePage((current) => ({
      ...current,
      examId: null,
      answers: {},
      startedAt: null,
      review: null,
      scrollY: 0,
    }));
    window.scrollTo(0, 0);
  }
  function leaveReview() {
    updatePage((current) => ({
      ...current,
      review: null,
      answers: {},
      scrollY: 0,
    }));
    window.scrollTo(0, 0);
  }
  if (review && reviewExam) {
    const reviewQuestions = reviewExam.questions;
    const reviewAnswers = review.answers || {};
    const reviewTotal = reviewQuestions.length;
    const reviewAnswered = Object.keys(reviewAnswers).length;
    return (
      <section>
        <PageTitle
          eyebrow="REVIEW"
          title={`${reviewExam.title}｜${review.score} 分`}
          text="交卷後才顯示中文解析；紅色是你的答案，綠色是正確答案。"
        />
        <div className="review-summary">
          <strong>
            {review.score >= reviewExam.threshold ? "合格" : "需要再加強"}
          </strong>
          <span>
            作答時間 {Math.floor(review.seconds / 60)} 分 {review.seconds % 60}{" "}
            秒
          </span>
        </div>
        <div className="exam-layout review-layout">
          <ExamAnswerCard
            questions={reviewQuestions}
            answers={reviewAnswers}
            mode="review"
            onJump={scrollToReviewQuestion}
            currentIndex={currentQuestionIndex}
            statusPrefix="review-answer"
            answeredCount={reviewAnswered}
            totalQuestions={reviewTotal}
            unansweredCount={Math.max(0, reviewTotal - reviewAnswered)}
          />
        <div className="exam-review">
          {reviewQuestions.map((question, index) => (
            <article
              key={question.id}
              id={`review-question-${index + 1}`}
              className="review-item"
            >
              <span>
                {question.section} · 問題 {index + 1}
              </span>
              <h3>{question.prompt}</h3>
              {question.passage && (
                <p className="exam-passage" lang="ja">
                  {question.passage}
                </p>
              )}
              {question.audioText && (
                <ExampleAudio
                  text={question.audioText}
                  settings={settings}
                  label="聽力音檔"
                />
              )}
              <ol>
                {question.options.map((option, optionIndex) => (
                  <li
                    key={`${option}-${optionIndex}`}
                    className={
                      optionIndex === question.answer
                        ? "correct"
                        : optionIndex === reviewAnswers[index]
                          ? "wrong"
                          : ""
                    }
                  >
                    {option}
                  </li>
                ))}
              </ol>
              <p className="answer-explanation">
                中文解析：{question.explanationZh}
              </p>
            </article>
          ))}
        </div>
        </div>
        <button className="primary" onClick={leaveReview}>
          返回模考列表
        </button>
      </section>
    );
  }
  if (exam)
    return (
      <section className="mock-exam-section">
        <PageTitle
          eyebrow="SIMULATION"
          title={exam.title}
          text={`自編模擬試驗 · ${exam.durationMinutes} 分鐘 · ${exam.questionCount} 題 · 及格 ${exam.threshold} 分`}
        />
        <div className="exam-control-bar" aria-label="模考作答狀態與操作">
          <button type="button" onClick={cancelExam}>
            取消作答
          </button>
          <div className="exam-control-title">
            <strong>{exam.title}</strong>
            <span>
              已答 {answeredCount} · 未答 {unansweredCount} · 共{" "}
              {totalQuestions} 題
            </span>
          </div>
          <div className="exam-control-clock">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </div>
          <button className="primary" type="button" onClick={finish}>
            {unansweredCount ? "提前交卷" : "交卷"}
          </button>
          <div className="exam-mobile-answer-strip">
            <ExamAnswerCard
              questions={questions}
              answers={answers}
              mode="practice"
              onJump={scrollToQuestion}
              currentIndex={currentQuestionIndex}
              statusPrefix="practice-answer"
              answeredCount={answeredCount}
              totalQuestions={totalQuestions}
              unansweredCount={unansweredCount}
            />
          </div>
        </div>
        <div className="exam-notice">
          <b>受験上の注意</b>
          <p>
            問題と選択肢はすべて日本語です。最もよい答えを一つ選んでください。解説は答案を提出した後に表示されます。
          </p>
        </div>
        <div className="exam-layout">
          <aside className="exam-answer-card" aria-label="答題卡">
            <div className="answer-card-head">
              <div>
                <span className="eyebrow">ANSWER CARD</span>
                <h3>答題卡</h3>
              </div>
              <strong>共 {totalQuestions} 題</strong>
            </div>
            <div className="answer-card-stats">
              <article>
                <span>已答題</span>
                <strong>{answeredCount}</strong>
              </article>
              <article>
                <span>未答題</span>
                <strong>{unansweredCount}</strong>
              </article>
              <article>
                <span>總題數</span>
                <strong>{totalQuestions}</strong>
              </article>
            </div>
            <div className="answer-card-grid">
              {questions.map((question, index) => {
                const answered = answers[index] !== undefined;
                return (
                  <button
                    key={question.id}
                    type="button"
                    className={`${answered ? "answered" : "unanswered"} ${
                      currentQuestionIndex === index ? "current" : ""
                    }`}
                    aria-current={
                      currentQuestionIndex === index ? "true" : undefined
                    }
                    onClick={() => scrollToQuestion(index)}
                    aria-label={`第 ${index + 1} 題，${answered ? "已答" : "未答"}`}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
            <div className="answer-card-legend">
              <span>
                <i className="answered" /> 已答
              </span>
              <span>
                <i className="unanswered" /> 未答
              </span>
            </div>
          </aside>
          <div className="exam-sheet">
          {questions.map((question, index) => (
            <fieldset key={question.id} id={`exam-question-${index + 1}`}>
              <div className="question-meta">
                <span>{question.section}</span>
                <b>{question.type}</b>
              </div>
              <p className="exam-instruction">{question.instruction}</p>
              {question.passage && (
                <p className="exam-passage" lang="ja">
                  {question.passage}
                </p>
              )}
              {question.audioText && (
                <ExampleAudio
                  text={question.audioText}
                  settings={settings}
                  label="聴解音声"
                />
              )}
              <legend>
                {index + 1}. {question.prompt}
              </legend>
              {question.options.map((option, optionIndex) => (
                <label key={`${option}-${optionIndex}`}>
                  <input
                    type="radio"
                    name={`q${index}`}
                    checked={answers[index] === optionIndex}
                    onChange={() => answerQuestion(index, optionIndex)}
                  />
                  <span>{optionIndex + 1}</span>
                  {option}
                </label>
              ))}
            </fieldset>
          ))}
          <div className="exam-actions">
            <button type="button" onClick={cancelExam}>
              取消作答
            </button>
            <button className="primary" type="button" onClick={finish}>
              {unansweredCount ? "提前交卷" : "答案を提出する（交卷）"}
            </button>
          </div>
          <p className="answer-count">
            已答：{answeredCount} / {totalQuestions}，未答：{unansweredCount}
          </p>
        </div>
        </div>
      </section>
    );
  return (
    <section>
      <PageTitle
        eyebrow="ASSESSMENT"
        title="月檢核與模考"
        text="全部為自編題目；官方資源只提供題型參考連結。"
      />
      <PeriodPicker
        viewPeriod={activePeriod}
        setViewPeriod={setViewPeriod}
        unlockedThrough={unlockedThrough}
        hint={`可作答 ${list.length} 份`}
      />
      {!list.length && <Empty text="這個月份尚無檢核，請切換到其他月份。" />}
      <div className="assessment-grid">
        {list.map((x) => (
          <article key={x.id}>
            <span>
              {x.level} · {x.kind === "monthly" ? "月檢核" : "完整模考"}
            </span>
            <h3>{x.title}</h3>
            <p>
              {x.durationMinutes} 分鐘 · {x.questionCount} 題 · 門檻{" "}
              {x.threshold}
            </p>
            <button
              onClick={() => {
                updatePage((current) => ({
                  ...current,
                  examId: x.id,
                  answers: {},
                  startedAt: Date.now(),
                  review: null,
                  scrollY: 0,
                }));
                window.scrollTo(0, 0);
              }}
            >
              開始作答
            </button>
          </article>
        ))}
      </div>
      <a
        className="source-link"
        href="https://www.jlpt.jp/e/samples/sampleindex.html"
        target="_blank"
        rel="noreferrer"
      >
        JLPT 官方題型與著作權說明 ↗
      </a>
    </section>
  );
}

function ProgressView({
  data,
  // The month whose material is available. Only the default for the report and
  // the ceiling of its picker — the report itself has its own selection, kept
  // separate from the rail so browsing old material does not change the report.
  currentPeriod,
  store,
  pageState,
  updatePage,
  dailyPace,
}) {
  const options = reportablePeriods(currentPeriod);
  const selected = options.includes(pageState.reportPeriod)
    ? pageState.reportPeriod
    : currentPeriod;
  const report = useMemo(
    () =>
      buildMonthlyReport({
        data,
        progress: store.progress,
        events: store.events,
        period: selected,
      }),
    [data, store.progress, store.events, selected],
  );
  const isCurrentMonth = selected === currentPeriod;
  const weak = Object.values(store.progress).filter(
    (x) => x.rating === "hard",
  ).length;
  function exportCsv() {
    // One row per period, each with that period's own figures rather than the
    // selected month's rate repeated down the column.
    const rows = [
      [
        "月份",
        "原訂累積單字",
        "原訂累積文法",
        "當月新增教材",
        "累積已解鎖",
        "累積完成",
        "當月新完成",
        "完成率",
        "當月學習事件",
      ],
      ...reportablePeriods(currentPeriod).map((period) => {
        const row = buildMonthlyReport({
          data,
          progress: store.progress,
          events: store.events,
          period,
        });
        return [
          period,
          row.planned.vocabulary,
          row.planned.grammar,
          row.newTotal,
          row.unlockedTotal,
          row.completedTotal,
          row.completedThisMonth,
          `${row.rate}%`,
          row.events,
        ];
      }),
    ];
    download(
      `日語階梯成果-${selected}.csv`,
      rows.map((r) => r.map(csvCell).join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
  }
  return (
    <section>
      <PageTitle
        eyebrow="PROGRESS"
        title="進度成果"
        text="每次練習都只保存在這台裝置；可輸出 CSV 或直接列印。"
      />
      <DailyPaceCard pace={dailyPace} compact />
      <div className="metric-grid">
        <article>
          <span>已有學習紀錄</span>
          <strong>{report.completedTotal.toLocaleString()}</strong>
          <small>/ {report.unlockedTotal.toLocaleString()}</small>
        </article>
        <article>
          <span>{isCurrentMonth ? "目前完成率" : "當月完成率"}</span>
          <strong>{report.rate}%</strong>
          <small>截至 {formatPeriod(selected)} 解鎖內容</small>
        </article>
        <article>
          <span>需加強</span>
          <strong>{weak}</strong>
          <small>評為「有點難」</small>
        </article>
        <article>
          <span>檢核完成</span>
          <strong>{store.results.length}</strong>
          <small>/ 19 次</small>
        </article>
      </div>
      <div className="report-card">
        <div className="report-head">
          <div>
            <span>月報 · {formatPeriod(selected)}</span>
            <h2>計畫與實際進度</h2>
          </div>
          <label className="report-period">
            報告月份
            <select
              value={selected}
              onChange={(event) =>
                updatePage((current) => ({
                  ...current,
                  reportPeriod: event.target.value,
                }))
              }
            >
              {options.map((period) => (
                <option key={period} value={period}>
                  {formatPeriod(period)}
                  {period === currentPeriod ? "（本月）" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="progress-bar">
          <i style={{ width: `${report.rate}%` }} />
        </div>
        <p>
          原訂累積：單字 {report.planned.vocabulary}、文法{" "}
          {report.planned.grammar}；當月新增教材{" "}
          {report.newTotal.toLocaleString()} 項。
          {isCurrentMonth ? "截至今日" : `截至 ${formatPeriod(selected)} 月底`}
          已解鎖 {report.unlockedTotal.toLocaleString()} 項，累積完成{" "}
          {report.completedTotal.toLocaleString()} 項（{report.rate}%）；
          當月新完成 {report.completedThisMonth.toLocaleString()} 項，
          記錄 {report.events} 次學習事件。
        </p>
        {isCurrentMonth ? (
          <p>
            截至今日應達 {dailyPace.expectedTotal.toLocaleString()} 項，實際完成{" "}
            {dailyPace.actualTotal.toLocaleString()} 項，
            {dailyPace.delta > 0
              ? `超前 ${dailyPace.delta} 項。`
              : dailyPace.delta < 0
                ? `落後 ${Math.abs(dailyPace.delta)} 項。`
                : "目前符合進度。"}
          </p>
        ) : (
          <p>
            這是{formatPeriod(selected)}的封存月報；每日進度只適用於本月，因此不列在這裡。
          </p>
        )}
        <div>
          <button className="primary" onClick={exportCsv}>
            匯出 CSV
          </button>
          <button onClick={() => window.print()}>列印成果報告</button>
        </div>
      </div>
    </section>
  );
}

const SCHEDULE_TARGET_FIELDS = [
  ["vocabulary", "單字目標", 4000],
  ["grammar", "文法目標", 240],
  ["reading", "閱讀篇數", 52],
  ["listening", "聽力組數", 104],
];

function ScheduleSettingsPanel({
  scheduleSettings,
  setScheduleSettings,
  resetScheduleSettings,
}) {
  const startTime = Date.parse(`${scheduleSettings.startDate}T00:00:00`);
  const endTime = Date.parse(`${scheduleSettings.endDate}T00:00:00`);
  const invalidRange =
    Number.isFinite(startTime) && Number.isFinite(endTime) && endTime < startTime;
  return (
    <article className="schedule-settings-card">
      <div className="settings-card-head">
        <div>
          <span className="eyebrow">SCHEDULE</span>
          <h3>日程與目標設定</h3>
        </div>
        <span className={`status-dot ${scheduleSettings.enabled ? "active" : ""}`}>
          {scheduleSettings.enabled ? "使用自訂進度" : "使用預設年度安排"}
        </span>
      </div>
      <p>
        這裡只調整「每日進度指標」怎麼判斷超前或落後；教材原本的
        115/07～116/06 解鎖時間不會被變動。
      </p>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={scheduleSettings.enabled}
          onChange={(event) =>
            setScheduleSettings((current) => ({
              ...current,
              enabled: event.target.checked,
            }))
          }
        />
        <span>啟用自訂進度與目標</span>
      </label>
      <label>
        目標名稱
        <input
          type="text"
          value={scheduleSettings.goalName}
          onChange={(event) =>
            setScheduleSettings((current) => ({
              ...current,
              goalName: event.target.value,
            }))
          }
        />
      </label>
      <div className="schedule-form-grid">
        <label>
          開始日期
          <input
            type="date"
            value={scheduleSettings.startDate}
            onChange={(event) =>
              setScheduleSettings((current) => ({
                ...current,
                startDate: event.target.value,
              }))
            }
          />
        </label>
        <label>
          結束日期
          <input
            type="date"
            value={scheduleSettings.endDate}
            onChange={(event) =>
              setScheduleSettings((current) => ({
                ...current,
                endDate: event.target.value,
              }))
            }
          />
        </label>
        <label>
          每週學習分鐘
          <input
            type="number"
            min="0"
            max="10080"
            value={scheduleSettings.weeklyMinutes}
            onChange={(event) =>
              setScheduleSettings((current) => ({
                ...current,
                weeklyMinutes: event.target.value,
              }))
            }
          />
        </label>
      </div>
      {invalidRange && (
        <p className="form-error">結束日期不可早於開始日期；系統會先以單日目標計算。</p>
      )}
      <div className="schedule-target-grid">
        {SCHEDULE_TARGET_FIELDS.map(([key, label, max]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min="0"
              max={max}
              value={scheduleSettings.targets[key]}
              onChange={(event) =>
                setScheduleSettings((current) => ({
                  ...current,
                  targets: {
                    ...current.targets,
                    [key]: event.target.value,
                  },
                }))
              }
            />
            <small>最多 {max.toLocaleString()}，不會新增或刪除教材。</small>
          </label>
        ))}
      </div>
      <label>
        學習備註
        <textarea
          value={scheduleSettings.notes}
          onChange={(event) =>
            setScheduleSettings((current) => ({
              ...current,
              notes: event.target.value,
            }))
          }
          placeholder="例如：每天通勤 20 分鐘、週末補閱讀與模考。"
        />
      </label>
      <div className="schedule-actions">
        <button type="button" onClick={resetScheduleSettings}>
          重設為預設年度安排
        </button>
      </div>
    </article>
  );
}

function SettingsView({
  settings,
  setSettings,
  scheduleSettings,
  setScheduleSettings,
  resetScheduleSettings,
  onRestored,
  drive,
}) {
  const [voices, setVoices] = useState([]);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef();
  useEffect(() => {
    const update = () => setVoices(getJapaneseVoices());
    update();
    speechSynthesis?.addEventListener?.("voiceschanged", update);
    return () =>
      speechSynthesis?.removeEventListener?.("voiceschanged", update);
  }, []);
  async function backup() {
    const snapshot = await loadSnapshot();
    download(
      `nihongo-stairs-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(
        { backupVersion: 2, createdAt: new Date().toISOString(), ...snapshot },
        null,
        2,
      ),
      "application/json",
    );
  }
  async function chooseFile(event) {
    try {
      const json = JSON.parse(await event.target.files[0].text());
      if (json.backupVersion !== 2) throw new Error("備份版本不符");
      setPreview(json);
    } catch (error) {
      alert(`無法讀取備份：${error.message}`);
    }
  }
  async function restore() {
    await restoreSnapshot(preview, { forceDrive: true });
    setPreview(null);
    onRestored();
  }
  return (
    <section>
      <PageTitle
        eyebrow="SETTINGS"
        title="設定與資料"
        text="連結 Google 雲端硬碟後同步手機與電腦；離線時仍保存在本機。"
      />
      <div className="settings-grid">
        <DriveSyncPanel drive={drive} />
        <ScheduleSettingsPanel
          scheduleSettings={scheduleSettings}
          setScheduleSettings={setScheduleSettings}
          resetScheduleSettings={resetScheduleSettings}
        />
        <article>
          <h3>日語語音</h3>
          <label>
            速度 <output>{settings.rate}×</output>
            <input
              type="range"
              min="0.6"
              max="1.3"
              step="0.05"
              value={settings.rate}
              onChange={(e) =>
                setSettings((x) => ({ ...x, rate: Number(e.target.value) }))
              }
            />
          </label>
          <label>
            語音
            <select
              value={settings.voiceURI}
              onChange={(e) =>
                setSettings((x) => ({ ...x, voiceURI: e.target.value }))
              }
            >
              <option value="">自動選擇</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() =>
              speakJapanese("毎日少しずつ、前へ進みましょう。", settings)
            }
          >
            測試播放
          </button>
          {!voices.length && (
            <p className="warning">
              找不到日語語音。請至 Android「文字轉語音輸出」下載日文語音資料。
            </p>
          )}
        </article>
        <article>
          <h3>完整教材</h3>
          <p>
            下載單一 UTF-8
            文字檔，包含全部單字、文法、閱讀、聽力、試題、答案與中文解析。
          </p>
          <a
            className="primary download-link"
            href={`${import.meta.env.BASE_URL}日語階梯_完整教材.txt`}
            download
          >
            下載完整教材 TXT
          </a>
          <small>約 3.42 MB，可離線保存與列印。</small>
        </article>
        <article>
          <h3>備份與還原</h3>
          <p>JSON 包含進度、學習事件、檢核結果、報告與設定。</p>
          <button className="primary" onClick={backup}>
            匯出 JSON 備份
          </button>
          <button onClick={() => fileRef.current.click()}>選擇備份檔</button>
          <input
            ref={fileRef}
            hidden
            type="file"
            accept="application/json"
            onChange={chooseFile}
          />
          {preview && (
            <div className="restore-preview">
              <b>備份預覽</b>
              <p>
                {new Date(preview.createdAt).toLocaleString()} ·{" "}
                {(preview.studyEvents || []).length} 筆事件
              </p>
              <strong>確認後會完整覆蓋本機資料，不會合併。</strong>
              <button className="danger" onClick={restore}>
                確認覆蓋
              </button>
            </div>
          )}
        </article>
        <article>
          <h3>安裝與離線</h3>
          <p>
            Android Chrome：選單
            →「新增至主畫面」或「安裝應用程式」。首次連線後，教材可離線重開。
          </p>
          <span className="status-dot">● 僅儲存在本機</span>
        </article>
        <article>
          <h3>內容來源</h3>
          <p>
            <a href="https://www.edrdg.org/" target="_blank" rel="noreferrer">
              EDRDG / JMdict ↗
            </a>
          </p>
          <p>
            <a
              href="https://tadoku.org/japanese/en/free-books-en/"
              target="_blank"
              rel="noreferrer"
            >
              Tadoku 延伸閱讀 ↗
            </a>
          </p>
          <p>
            <a href="https://minato-jf.jp/" target="_blank" rel="noreferrer">
              Minato 線上課程 ↗
            </a>
          </p>
        </article>
      </div>
    </section>
  );
}

function PageTitle({ eyebrow, title, text }) {
  return (
    <div className="page-title">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  );
}
function Empty({ text }) {
  return <div className="empty">{text}</div>;
}
function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function useScheduleSettings() {
  const [scheduleSettings, setScheduleSettings] = useState(
    DEFAULT_SCHEDULE_SETTINGS,
  );
  const [ready, setReady] = useState(false);
  const load = useCallback(() => {
    getAll("settings")
      .then((xs) => {
        const saved = xs.find((x) => x.id === "schedule-plan")?.value;
        setScheduleSettings(normalizeScheduleSettings(saved));
      })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    void load();
    window.addEventListener(REMOTE_APPLIED_EVENT, load);
    return () => window.removeEventListener(REMOTE_APPLIED_EVENT, load);
  }, [load]);
  useEffect(() => {
    if (!ready) return;
    void put("settings", {
      id: "schedule-plan",
      value: scheduleSettings,
      updatedAt: scheduleSettings.updatedAt,
    });
  }, [ready, scheduleSettings]);
  const updateScheduleSettings = useCallback((updater) => {
    setScheduleSettings(withScheduleUpdatedAt(updater));
  }, []);
  const resetScheduleSettings = useCallback(() => {
    setScheduleSettings(
      normalizeScheduleSettings({
        ...DEFAULT_SCHEDULE_SETTINGS,
        updatedAt: new Date().toISOString(),
      }),
    );
  }, []);
  return {
    scheduleSettings,
    scheduleReady: ready,
    updateScheduleSettings,
    resetScheduleSettings,
  };
}

export default function App() {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [topbarCollapsed, setTopbarCollapsed] = useState(false);
  const drive = useGoogleDriveSync();
  // Derived from the clock every minute; never read from the saved session.
  const unlockedThrough = useUnlockedThrough();
  const today = useToday();
  const {
    session,
    ready: sessionReady,
    updatePage,
    setView,
    setViewPeriod,
  } = useUiSession(unlockedThrough);
  const [settings, setSettings] = useState({ rate: 0.85, voiceURI: "" });
  const [settingsReady, setSettingsReady] = useState(false);
  const {
    scheduleSettings,
    scheduleReady,
    updateScheduleSettings,
    resetScheduleSettings,
  } = useScheduleSettings();
  const updateSettings = useCallback((updater) => {
    setSettings((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...next, updatedAt: new Date().toISOString() };
    });
  }, []);
  const store = useLearningStore();
  const pageActions = useMemo(
    () =>
      Object.fromEntries(
        Object.keys(DEFAULT_PAGE_STATES).map((page) => [
          page,
          (updater) => updatePage(page, updater),
        ]),
      ),
    [updatePage],
  );
  const view = session.view;
  // Browsing selection for the library / media / mock / progress pages. Today's
  // study always runs off unlockedThrough instead.
  const viewPeriod = session.viewPeriod;
  const dailyPace = useMemo(
    () => calculateDailyProgress(data, store.progress, new Date(), scheduleSettings),
    [data, store.progress, scheduleSettings],
  );
  useEffect(() => {
    loadStudyData()
      .then(async (loaded) => {
        setData(loaded);
        // Ids whose word changed in the rebuild carry ratings that describe a
        // different word; drop those once so the learner re-meets them fresh.
        await resetReissuedProgress(
          loaded.index?.contentVersion,
          loaded.index?.reissuedIds,
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const load = () =>
      getAll("settings")
        .then((xs) => {
          const saved = xs.find((x) => x.id === "tts")?.value;
          if (saved) setSettings(saved);
        })
        .finally(() => setSettingsReady(true));
    void load();
    window.addEventListener(REMOTE_APPLIED_EVENT, load);
    return () => window.removeEventListener(REMOTE_APPLIED_EVENT, load);
  }, []);
  useEffect(() => {
    if (settingsReady)
      void put("settings", {
        id: "tts",
        value: settings,
      });
  }, [settings, settingsReady]);
  useEffect(() => {
    if (!sessionReady) return;
    const frame = requestAnimationFrame(() =>
      window.scrollTo(0, Number(session.pages[view]?.scrollY) || 0),
    );
    return () => cancelAnimationFrame(frame);
  }, [sessionReady, view]);
  useEffect(() => {
    let previousY = window.scrollY;
    const update = () => {
      const currentY = window.scrollY;
      if (menuOpen || currentY < 24) {
        setTopbarCollapsed(false);
        previousY = currentY;
        return;
      }
      if (currentY > previousY + 8 && currentY > 90)
        setTopbarCollapsed(true);
      else if (currentY < previousY - 8) setTopbarCollapsed(false);
      previousY = currentY;
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [menuOpen]);
  if (loading || !sessionReady || !settingsReady || !scheduleReady || !store.ready)
    return (
      <div className="loading-screen">
        <b>日語階梯</b>
        <span>正在恢復教材與學習進度…</span>
      </div>
    );
  if (error)
    return (
      <div className="loading-screen">
        <b>教材載入失敗</b>
        <span>{error}</span>
      </div>
    );
  const completed = dailyPace.actualTotal;
  return (
    <div className={`app-shell${topbarCollapsed ? " topbar-collapsed" : ""}`}>
      <Header
        view={view}
        setView={setView}
        completed={completed}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        drive={drive}
      />
      <div className="app-body">
        <PeriodRail
          viewPeriod={viewPeriod}
          setViewPeriod={setViewPeriod}
          unlockedThrough={unlockedThrough}
          data={data}
        />
        <main>
          {view === "today" && (
            <TodayView
              data={data}
              activePeriod={unlockedThrough}
              today={today}
              store={store}
              settings={settings}
              pageState={session.pages.today}
              updatePage={pageActions.today}
              dailyPace={dailyPace}
              goMedia={(type) => {
                pageActions.media((current) => ({
                  ...current,
                  type,
                  selected: 0,
                  transcript: false,
                }));
                setView("media");
              }}
            />
          )}
          {view === "library" && (
            <LibraryView
              data={data}
              activePeriod={viewPeriod}
              setViewPeriod={setViewPeriod}
              unlockedThrough={unlockedThrough}
              store={store}
              settings={settings}
              pageState={session.pages.library}
              updatePage={pageActions.library}
            />
          )}{" "}
          {view === "media" && (
            <MediaView
              data={data}
              activePeriod={viewPeriod}
              setViewPeriod={setViewPeriod}
              unlockedThrough={unlockedThrough}
              settings={settings}
              store={store}
              pageState={session.pages.media}
              updatePage={pageActions.media}
            />
          )}{" "}
          {view === "mock" && (
            <MockView
              data={data}
              activePeriod={viewPeriod}
              setViewPeriod={setViewPeriod}
              unlockedThrough={unlockedThrough}
              store={store}
              settings={settings}
              pageState={session.pages.mock}
              updatePage={pageActions.mock}
            />
          )}{" "}
          {view === "progress" && (
            <ProgressView
              data={data}
              currentPeriod={unlockedThrough}
              store={store}
              pageState={session.pages.progress}
              updatePage={pageActions.progress}
              dailyPace={dailyPace}
            />
          )}{" "}
          {view === "settings" && (
            <SettingsView
              settings={settings}
              setSettings={updateSettings}
              scheduleSettings={scheduleSettings}
              setScheduleSettings={updateScheduleSettings}
              resetScheduleSettings={resetScheduleSettings}
              drive={drive}
              onRestored={() => {
                localStorage.removeItem("nihongo-stairs-ui-session");
                notifyRemoteApplied();
              }}
            />
          )}
        </main>
      </div>
      <nav className="bottom-nav">
        {NAV.slice(0, 5).map(([id, label, icon]) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            onClick={() => setView(id)}
          >
            <b>{icon}</b>
            <span>{label.replace("學習", "")}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
