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
import { buildMonthlyReport, reportablePeriods } from "./monthlyReport";
import DriveSyncPanel from "./DriveSyncPanel";
import { buildStudyQuiz, rememberQuizRound } from "./studyQuiz";
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
    index: 0,
    revealed: false,
    scrollY: 0,
    seenByBatch: {},
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
  progress: { feedback: "", scrollY: 0, reportPeriod: null },
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

function StudyQuizPanel({
  quiz,
  settings,
  onAnswer,
  onNext,
  onFinish,
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
  if (!question) return null;
  return (
    <div className="lesson-card study-quiz-card">
      <div className="lesson-top">
        <span>
          3 題小測驗 · 第 {currentIndex + 1} / {questions.length} 題
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
            <strong>{answer.correct ? "答對了" : "這題要再加強"}</strong>
            <span>正確意思：{question.correctMeaning}</span>
          </div>
        )}
      </div>
      <footer className="study-quiz-footer">
        <span>
          已答 {answeredCount} · 正確 {correctCount} · 共 {questions.length}
        </span>
        {finished ? (
          <button onClick={onFinish}>回到卡片</button>
        ) : (
          <button disabled={!answer} onClick={onNext}>
            下一題
          </button>
        )}
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
  const completedInBatch = cards.filter((item) =>
    STRONG_RATINGS.has(store.progress[item.id]?.rating),
  ).length;
  const index = Number(pageState.index) || 0;
  const revealed = Boolean(pageState.revealed);
  const [notice, setNotice] = useState("");
  const card = cards[index % Math.max(1, cards.length)];
  // In review mode each finished round bumps the counter, which changes the key
  // and lets the quiz effect below start a fresh round — the endless loop that
  // runs until Monday raises the weekly cap.
  const reviewRound = Number(pageState.reviewRound) || 0;
  const batchKey = reviewMode
    ? `${activePeriod}:review:${reviewRound}`
    : `${activePeriod}:${batchIndex}`;
  const activeQuiz =
    pageState.quiz?.batchKey === batchKey ? pageState.quiz : null;
  const seenByBatch = pageState.seenByBatch || {};
  const currentSeenIds = seenByBatch[batchKey] || [];
  const quizCandidates = useMemo(
    () => [...unlocked.v, ...unlocked.g],
    [unlocked.v, unlocked.g],
  );
  const quizItemsById = useMemo(
    () => new Map(quizCandidates.map((item) => [item.id, item])),
    [quizCandidates],
  );
  const learnedQuizPool = useMemo(() => {
    const seenIds = new Set(currentSeenIds);
    return quizCandidates.filter(
      (item) => store.progress[item.id] || seenIds.has(item.id),
    );
  }, [quizCandidates, store.progress, currentSeenIds]);
  const previousBatchKey = useRef(batchKey);
  useEffect(() => {
    if (previousBatchKey.current !== batchKey) {
      updatePage((current) => ({
        ...current,
        index: 0,
        revealed: false,
        quiz: null,
      }));
      previousBatchKey.current = batchKey;
    }
  }, [batchKey, updatePage]);
  const markCardSeen = useCallback(
    (itemId) => {
      if (!itemId) return;
      updatePage((current) => {
        const nextSeenByBatch = { ...(current.seenByBatch || {}) };
        const batchSeen = new Set(nextSeenByBatch[batchKey] || []);
        if (batchSeen.has(itemId)) return current;
        batchSeen.add(itemId);
        nextSeenByBatch[batchKey] = [...batchSeen];
        return { ...current, seenByBatch: nextSeenByBatch };
      });
    },
    [batchKey, updatePage],
  );
  useEffect(() => {
    markCardSeen(card?.id);
  }, [card?.id, markCardSeen]);
  useEffect(() => {
    if (!cards.length || activeQuiz) return;
    const seenIds = new Set(currentSeenIds);
    if (!cards.every((item) => seenIds.has(item.id))) return;
    const questions = buildStudyQuiz({
      pool: learnedQuizPool,
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
    activeQuiz,
    batchKey,
    cards,
    currentSeenIds,
    learnedQuizPool,
    pageState.recentQuizRounds,
    quizCandidates,
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
      updatePage((current) => {
        if (current.quiz?.id !== quiz.id) return current;
        return {
          ...current,
          quiz: {
            ...current.quiz,
            answers: {
              ...(current.quiz.answers || {}),
              [currentIndex]: { selectedIndex, correct, answeredAt },
            },
          },
        };
      });
      const item = quizItemsById.get(question.itemId);
      if (item) {
        await store.recordQuizAnswer(item, correct, {
          selectedOption: question.options[selectedIndex],
          correctOption: question.correctMeaning,
          quizRoundId: quiz.id,
          quizQuestion: currentIndex + 1,
        });
      }
    },
    [pageState.quiz, quizItemsById, store, updatePage],
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
      const nextSeenByBatch = { ...(current.seenByBatch || {}) };
      nextSeenByBatch[batchKey] = [];
      return {
        ...current,
        quiz: null,
        revealed: false,
        seenByBatch: nextSeenByBatch,
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
  async function rate(value) {
    const willAdvance =
      STRONG_RATINGS.has(value) &&
      cards.every(
        (item) =>
          item.id === card.id ||
          STRONG_RATINGS.has(store.progress[item.id]?.rating),
      );
    await store.rate(card, value, {
      dailyBatch: batchIndex + 1,
      unlockPeriod: activePeriod,
    });
    if (willAdvance) {
      updatePage((current) => ({ ...current, index: 0, revealed: false }));
      const hasNextBatch = Boolean(batches[batchIndex + 1]?.length);
      const withinWeeklyCap = batchIndex + 1 < plan.allowedBatches;
      setNotice(
        hasNextBatch && withinWeeklyCap
          ? `本批次全部達到「記得」以上，已自動開放第 ${batchIndex + 2} 批新內容。`
          : hasNextBatch
            ? "本批完成，但已達本週開放上限；先進入複習模式，下週一自動開放新進度。"
            : "目前開放的教材已全部完成！",
      );
    } else {
      setNotice("");
      updatePage((current) => ({
        ...current,
        revealed: false,
        index: ((Number(current.index) || 0) + 1) % cards.length,
      }));
    }
  }
  if (!card) {
    const nextUnlock = plan.nextUnlockAt;
    const nextUnlockText = `${nextUnlock.getMonth() + 1} 月 ${nextUnlock.getDate()} 日（週一）`;
    return (
      <section className="today-view">
        <div className="page-intro">
          <div>
            <span className="eyebrow">
              TODAY · {formatPeriod(activePeriod)} ·{" "}
              {reviewMode ? `複習第 ${reviewRound + 1} 輪` : "已完成"}
            </span>
            <h1>
              {reviewReason === "week"
                ? "本週的新教材已全部開放。"
                : "本月教材已全部完成。"}
            </h1>
            <p>
              {reviewReason === "week"
                ? `每週上限為 ${plan.allowance.vocabulary} 個單字、${plan.allowance.grammar} 條文法（累計至第 ${plan.allowance.week} 週）。接下來進入複習模式，小測驗會一輪接一輪，直到 ${nextUnlockText} 自動開放新進度。`
                : "你已把本月開放的內容全部標記為「記得」以上。先用小測驗保持手感，下個月會自動開放新教材。"}
            </p>
          </div>
          <div className="today-ring">
            <strong>{reviewRound + 1}</strong>
            <span>輪</span>
            <small>複習中</small>
          </div>
        </div>
        <DailyPaceCard pace={dailyPace} />
        <div className="week-card unlock-notice" role="status">
          ↻ 複習模式：{reviewReason === "week" ? `${nextUnlockText} 自動開放新教材` : "等待下個月解鎖"}
        </div>
        <div className="dashboard-grid">
          {activeQuiz ? (
            <StudyQuizPanel
              quiz={activeQuiz}
              settings={settings}
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
      <div className="dashboard-grid">
        {activeQuiz ? (
          <StudyQuizPanel
            quiz={activeQuiz}
            settings={settings}
            onAnswer={answerQuiz}
            onNext={nextQuizQuestion}
            onFinish={finishQuiz}
          />
        ) : (
          <div className="lesson-card">
          <div className="lesson-top">
            <span>
              {card.level} · {card.category === "vocab" ? "單字" : "文法"}
            </span>
            <button onClick={() => speakJapanese(card.audioText, settings)}>
              ▶ {card.category === "grammar" ? "播放文法句型" : "播放單字"}
            </button>
          </div>
          <div
            className={`card-main${revealed ? " is-revealed" : ""}`}
            onClick={() =>
              updatePage((current) => ({ ...current, revealed: true }))
            }
          >
            <h2>{card.term}</h2>
            <p className="reading">{card.reading}</p>
            {revealed ? (
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
              <button className="reveal">翻卡看答案</button>
            )}
          </div>
          <div className="rating-row">
            <button onClick={() => rate("again")}>再一次</button>
            <button onClick={() => rate("hard")}>有點難</button>
            <button onClick={() => rate("good")}>記得</button>
            <button onClick={() => rate("easy")}>很熟</button>
          </div>
          <footer>
            <button
              onClick={() =>
                updatePage((current) => ({
                  ...current,
                  index:
                    ((Number(current.index) || 0) - 1 + cards.length) %
                    cards.length,
                  revealed: false,
                }))
              }
            >
              ← 上一張
            </button>
            <span>
              {index + 1} / {cards.length}
            </span>
            <button
              onClick={() =>
                updatePage((current) => ({
                  ...current,
                  index: ((Number(current.index) || 0) + 1) % cards.length,
                  revealed: false,
                }))
              }
            >
              下一張 →
            </button>
          </footer>
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

function MediaView({
  data,
  activePeriod,
  settings,
  store,
  pageState,
  updatePage,
}) {
  const type = pageState.type || "reading";
  const list = data[type].filter((x) => isUnlocked(x, activePeriod));
  const rawSelected = Number(pageState.selected) || 0;
  const selected = list.length
    ? ((rawSelected % list.length) + list.length) % list.length
    : 0;
  const item = list[selected];
  const transcript = Boolean(pageState.transcript);
  const answer = pageState.answers?.[item?.id] ?? null;
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
  if (!item) return <Empty text="這個月份尚無閱讀／聽力教材。" />;
  const question = item.questions[0];
  const goToMediaItem = (nextIndex) =>
    updatePage((current) => ({
      ...current,
      selected: (nextIndex + list.length) % list.length,
      transcript: false,
      replays: 0,
      elapsed: 0,
      startedAt: null,
    }));
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
      <PageTitle
        eyebrow="READ · LISTEN"
        title="閱讀聽力"
        text="先作答，再看稿與解析；系統會記下重播與錯因。"
      />
      <div className="segmented">
        <button
          className={type === "reading" ? "active" : ""}
          onClick={() => selectType("reading")}
        >
          閱讀 52
        </button>
        <button
          className={type === "listening" ? "active" : ""}
          onClick={() => selectType("listening")}
        >
          聽力 104
        </button>
      </div>
      <div className="media-layout">
        <aside className="lesson-list">
          {list.slice(0, 30).map((x, i) => (
            <button
              key={x.id}
              className={i === selected ? "active" : ""}
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
            </button>
          ))}
        </aside>
        <article className="media-workspace">
          <div className="media-head">
            <div>
              {type === "reading" && item.newsStyle ? (
                <div className="news-meta">
                  <span>{item.level} · {item.newsCategory}新聞</span>
                  <time>{item.dateline}</time>
                </div>
              ) : (
                <span>
                  {item.level} · {type === "reading" ? "精讀" : "逐句聽解"}
                </span>
              )}
              <h2>{item.headline || item.term}</h2>
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
              <article className={item.newsStyle ? "news-article" : ""}>
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
          <div className="question">
            <h3>{question.prompt}</h3>
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
                onClick={() => {
                  updatePage((current) => ({
                    ...current,
                    answers: { ...(current.answers || {}), [item.id]: i },
                  }));
                  store.rate(item, i === question.answer ? "good" : "hard", {
                    replays,
                    answer: i,
                  });
                }}
              >
                {String.fromCharCode(65 + i)}. {option}
              </button>
            ))}
            {answer !== null && (
              <p className="explanation">
                {answer === question.answer ? "答對了。" : "再聽一次關鍵句。"}{" "}
                {question.explanation}
              </p>
            )}
          </div>
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
      ["月份", "原訂累積單字", "原訂累積文法", "已解鎖", "實際完成", "完成率", "當月學習事件"],
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
          row.unlockedTotal,
          row.completedTotal,
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
          {report.planned.grammar}；當月新增 {report.newTotal.toLocaleString()} 項。
          截至 {formatPeriod(selected)} 已解鎖{" "}
          {report.unlockedTotal.toLocaleString()} 項，實際完成{" "}
          {report.completedTotal.toLocaleString()} 項（{report.rate}%），
          當月記錄 {report.events} 次學習事件。
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
        <label>
          老師回饋
          <textarea
            value={pageState.feedback || ""}
            onChange={(event) =>
              updatePage((current) => ({
                ...current,
                feedback: event.target.value,
              }))
            }
            placeholder="列印後可書寫，或先在此輸入回饋…"
          />
        </label>
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
