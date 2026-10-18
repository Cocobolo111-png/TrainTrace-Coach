import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Dumbbell,
  Flag,
  History,
  Home,
  Minus,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SkipForward,
  Trash2,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import {
  type Exercise,
  type Profile,
  type Session,
  type State,
  type Theme,
  type TrainingSet,
  completeSet,
  changeRestDuration,
  completed,
  emptyState,
  finishSession,
  pauseSession,
  resumeSession,
  trainingSeconds,
  gears,
  stats,
  themes,
  uid,
  volume,
} from "./model";
import {
  catalog,
  finished,
  lastExercise,
  makeExercise,
  makePlan,
  recommend,
} from "./coach";
import {
  backup,
  mergeState,
  mutateState,
  readState,
  readGuidance,
  saveGuidance,
} from "./storage";
import { parseImport, type ImportPreview } from "./importer";
import { FeedbackCard } from "./FeedbackCard";
import { unlockRestAudio, playRestCue } from "./restCues";
import { movementIdentity, sameMovement } from "./feedback";
import { localAnalysisEnabled } from "./analysis";
import { useRegisterSW } from "virtual:pwa-register/react";
type Page = "home" | "plan" | "workout" | "history" | "settings" | "summary";
const date = (s: string, full = false) =>
  new Date(s).toLocaleDateString(
    "zh-CN",
    full
      ? { year: "numeric", month: "long", day: "numeric", weekday: "short" }
      : { month: "numeric", day: "numeric" },
  );
const fmt = (n: number) => Number(n.toFixed(1)).toLocaleString("zh-CN");
function Button({
  children,
  onClick,
  kind = "primary",
  disabled = false,
  type = "button",
  ...props
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  "aria-label"?: string;
}) {
  return (
    <button
      type={type}
      className={`button ${kind}`}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
}
function PageTitle({
  title,
  back,
  aside,
}: {
  title: string;
  back?: () => void;
  aside?: ReactNode;
}) {
  return (
    <div className="page-title">
      {back && (
        <button className="icon-button" onClick={back} aria-label="返回">
          <ArrowLeft />
        </button>
      )}
      <h1>{title}</h1>
      {aside}
    </div>
  );
}
function SetLine({ e }: { e: Exercise }) {
  return (
    <span>
      {completed(e).map((s, i) => (
        <span key={i}>
          {i > 0 ? " / " : ""}
          {s.weight === 0 && e.basis === "自重"
            ? "自重"
            : `${fmt(s.weight)} kg`}{" "}
          × {s.reps}
        </span>
      ))}
    </span>
  );
}
export function App() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });
  const [state, setState] = useState<State>(emptyState),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState<Page>("home"),
    [selected, setSelected] = useState<string | null>(null),
    [offline, setOffline] = useState(!navigator.onLine),
    [notice, setNotice] = useState(""),
    [theme, setTheme] = useState<Theme>("胸部"),
    [minutes, setMinutes] = useState(45),
    [recovery, setRecovery] = useState(false),
    [draft, setDraft] = useState<Exercise[]>([]),
    [focus, setFocus] = useState(0),
    [guideStep, setGuideStep] = useState(() => readGuidance().introStep),
    [replayGuide, setReplayGuide] = useState(false);
  const running = state.sessions.find((s) => s.status === "active"),
    previous = finished(state.sessions).at(-1),
    recommendation = recommend(state.sessions);
  const pending = useRef(0);
  useLayoutEffect(() => {
    if (page === "summary")
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [page, selected]);
  const refresh = () =>
    readState()
      .then((s) => {
        setState((current) => (s.revision >= current.revision ? s : current));
        setReady(true);
      })
      .catch((e) => {
        setError(
          `无法读取训练数据：${e.message}。请重试；不要清理浏览器数据。`,
        );
        setReady(true);
      });
  useEffect(() => {
    void refresh();
    let disposed = false;
    const controller = new AbortController();
    const online = () => setOffline(!navigator.onLine);
    // A network-only HEAD distinguishes cached navigation from connectivity.
    // Some browsers report onLine=true after an offline service-worker reload.
    const timeout = setTimeout(() => controller.abort(), 4000);
    void fetch(new URL("manifest.webmanifest", location.href), {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(() => {
        if (!disposed) setOffline(false);
      })
      .catch(() => {
        if (!disposed) setOffline(true);
      })
      .finally(() => clearTimeout(timeout));
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    const sync = () => {
      if (document.visibilityState === "visible" && !pending.current)
        void refresh();
    };
    document.addEventListener("visibilitychange", sync);
    const channel = new BroadcastChannel("traintrace-sync");
    channel.onmessage = () => {
      if (!pending.current) void refresh();
    };
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timeout);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
      document.removeEventListener("visibilitychange", sync);
      channel.close();
    };
  }, []);
  async function save(fn: (s: State) => State): Promise<boolean> {
    pending.current++;
    setBusy(true);
    setError("");
    try {
      const next = await mutateState(fn);
      setState((s) => (next.revision >= s.revision ? next : s));
      const c = new BroadcastChannel("traintrace-sync");
      c.postMessage("saved");
      c.close();
      return true;
    } catch (e) {
      setError(
        `保存未成功：${e instanceof Error ? e.message : "存储空间可能不足"}。本组尚未确认，请重试或先导出备份。`,
      );
      return false;
    } finally {
      pending.current--;
      setBusy(pending.current > 0);
    }
  }
  async function updateSession(id: string, fn: (s: Session) => Session) {
    return save((s) => ({
      ...s,
      sessions: s.sessions.map((x) => {
        if (x.id !== id) return x;
        if (x.status !== "active")
          throw Error("本节训练已在另一处结束，请重新读取");
        return fn(x);
      }),
    }));
  }
  function openPlan(t = theme) {
    setTheme(t);
    setRecovery(
      (recommendation.gap ?? 0) >= 14 || state.profile?.preference === "保守",
    );
    setDraft(
      makePlan(
        state.profile!,
        state.sessions,
        t,
        minutes,
        (recommendation.gap ?? 0) >= 14 || state.profile?.preference === "保守",
        readGuidance().defaultRest,
      ),
    );
    setPage("plan");
    window.scrollTo(0, 0);
  }
  function changePlan(t: Theme, m: number, r: boolean) {
    setTheme(t);
    setMinutes(m);
    setRecovery(r);
    setDraft(
      makePlan(
        state.profile!,
        state.sessions,
        t,
        m,
        r,
        readGuidance().defaultRest,
      ),
    );
  }
  async function start() {
    const session: Session = {
      id: uid(),
      theme,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: "active",
      exercises: draft,
      restUntil: null,
      note: "",
      recovery,
      source: "app",
    };
    if (
      await save((s) => {
        if (s.sessions.some((x) => x.status === "active"))
          throw Error("已有进行中训练，请先继续或结束");
        return { ...s, sessions: [...s.sessions, session] };
      })
    ) {
      setFocus(0);
      setPage("workout");
      window.scrollTo(0, 0);
    }
  }
  function go(p: Page) {
    setPage(p);
    setSelected(null);
    window.scrollTo(0, 0);
  }
  function showSession(s: Session) {
    setSelected(s.id);
    goDetail();
  }
  function goDetail() {
    setPage("summary");
  }
  const session = state.sessions.find((s) => s.id === selected);
  if (!ready)
    return (
      <div className="loading">
        <Dumbbell size={32} />
        <p>正在打开训练档案…</p>
      </div>
    );
  // A real profile always wins over presentation flags, including after import.
  if (replayGuide || (!state.profile && !error && guideStep < 3))
    return (
      <ImmersiveOnboarding
        initialStep={replayGuide ? 0 : guideStep}
        replay={replayGuide}
        onStep={(step) => {
          if (!replayGuide) {
            saveGuidance({ introStep: step });
            setGuideStep(step);
          }
        }}
        onComplete={() => {
          if (replayGuide) {
            setReplayGuide(false);
            go("settings");
          } else {
            saveGuidance({ introStep: 3 });
            setGuideStep(3);
            window.scrollTo(0, 0);
          }
        }}
      />
    );
  return (
    <div className={`shell${page === "workout" ? " workout-shell" : ""}`}>
      <header className="topbar">
        <button
          className="wordmark"
          onClick={() => go("home")}
          aria-label="TrainTrace 首页"
        >
          <span className="brandmark">
            <span />
            <span />
            <span />
          </span>
          TRAINTRACE<span className="wordmark-dot">.</span>
        </button>
        <span className="local-label">
          {offline ? (
            <>
              <WifiOff size={14} />
              离线可记录
            </>
          ) : (
            <>
              <span className="status-dot" />
              本地训练档案
            </>
          )}
        </span>
      </header>
      {error && (
        <div className="error" role="alert">
          <strong>{error}</strong>
          <Button kind="small" onClick={() => void refresh()}>
            重新读取
          </Button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setNotice("")}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <main>
        {!state.profile ? (
          <Onboarding
            busy={busy}
            onSave={(p) =>
              save((s) => ({ ...s, profile: p })).then((ok) => {
                if (ok) {
                  void navigator.storage?.persist?.();
                  setPage("home");
                }
              })
            }
            importView={
              <DataTools
                state={state}
                save={save}
                busy={busy}
                notify={setNotice}
              />
            }
          />
        ) : page === "home" ? (
          <>
            <div className="greeting">
              <p>
                {new Date().getHours() < 12
                  ? "早上好"
                  : new Date().getHours() < 18
                    ? "下午好"
                    : "晚上好"}{" "}
                · {date(new Date().toISOString(), true)}
              </p>
              <h1>
                让每一次训练，
                <br />
                都有迹可循。
              </h1>
            </div>
            <div className="last-session">
              {previous ? (
                <>
                  <History size={17} />
                  <span>
                    上次训练 · {date(previous.startedAt)} · {previous.theme}
                    <span className="muted"> · {stats(previous).sets} 组</span>
                  </span>
                </>
              ) : (
                <>
                  <Flag size={17} />
                  <span>你的第一节训练，从这里开始。</span>
                </>
              )}
            </div>
            {running ? (
              <section className="training-hero">
                <div className="hero-top">
                  <span className="live-label">
                    <span />
                    训练进行中
                  </span>
                  <span>{date(running.startedAt)}</span>
                </div>
                <h2>
                  {running.theme}
                  <span>训练</span>
                </h2>
                <p>{stats(running).sets} 组已记录，继续衔接你的进度。</p>
                <Button onClick={() => go("workout")}>
                  继续未完成训练
                  <ArrowRight size={21} />
                </Button>
                <button className="hero-link" onClick={() => go("workout")}>
                  结束或放弃本节训练
                  <ChevronRight size={16} />
                </button>
                <div className="hero-track" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
              </section>
            ) : (
              <section className="training-hero">
                <div className="hero-top">
                  <span>今日建议</span>
                  <button
                    className="hero-preferences"
                    onClick={() => go("settings")}
                  >
                    偏好设置
                  </button>
                </div>
                <h2>
                  {recommendation.theme}
                  <span>训练</span>
                </h2>
                <p>{recommendation.reason}</p>
                <div className="hero-metadata">
                  <span>
                    <Clock3 size={17} />
                    {minutes} 分钟内
                  </span>
                  <span>
                    <Dumbbell size={17} />
                    {
                      makePlan(
                        state.profile,
                        state.sessions,
                        recommendation.theme,
                        minutes,
                        false,
                      ).length
                    }{" "}
                    个主要动作
                  </span>
                </div>
                <Button onClick={() => openPlan(recommendation.theme)}>
                  开始训练
                  <ArrowRight size={21} />
                </Button>
                <div className="hero-track" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
              </section>
            )}
            {!running && (
              <div className="quick-themes">
                <span>按你的节奏</span>
                {themes
                  .filter((t) => t !== recommendation.theme)
                  .map((t) => (
                    <button key={t} onClick={() => openPlan(t)}>
                      {t}
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
              </div>
            )}
            <section className="recent">
              <div className="section-heading">
                <h2>最近训练</h2>
                <button className="text-button" onClick={() => go("history")}>
                  全部记录
                  <ArrowRight size={16} />
                </button>
              </div>
              {!previous ? (
                <div className="empty">
                  <div className="empty-grid" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <h3>记录，才是进步的起点。</h3>
                  <p>
                    完成第一节训练后，这里会留下你的实际表现。
                    <br />
                    下次打开，重量与次数自动衔接。
                  </p>
                </div>
              ) : (
                finished(state.sessions)
                  .slice(-3)
                  .reverse()
                  .map((s) => (
                    <HistoryRow
                      key={s.id}
                      s={s}
                      onClick={() => showSession(s)}
                    />
                  ))
              )}
            </section>
            <p className="footnote">
              <ShieldCheck size={15} />
              数据仅保存在此浏览器。定期导出，让积累更安心。
            </p>
          </>
        ) : page === "plan" ? (
          <>
            <PageTitle title="今天，怎么练" back={() => go("home")} />
            <div className="segmented">
              {themes.map((t) => (
                <button
                  key={t}
                  aria-pressed={theme === t}
                  className={theme === t ? "active" : ""}
                  onClick={() => changePlan(t, minutes, recovery)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="plan-controls">
              <div className="plan-budget">
                <label htmlFor="training-budget">今天准备练多久？</label>
                <select
                  id="training-budget"
                  aria-describedby="training-budget-help"
                  value={minutes}
                  onChange={(e) => changePlan(theme, +e.target.value, recovery)}
                >
                  {[20, 30, 45, 60].map((m) => (
                    <option key={m} value={m}>
                      {m} 分钟
                    </option>
                  ))}
                </select>
                <p className="helper" id="training-budget-help">
                  根据你的时间调整动作和组数。
                </p>
              </div>
              <div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    aria-describedby="recovery-help"
                    checked={recovery}
                    onChange={(e) =>
                      changePlan(theme, minutes, e.target.checked)
                    }
                  />
                  轻量恢复训练
                </label>
                <p className="helper" id="recovery-help">
                  适合停练一段时间，或今天状态不佳时使用。
                </p>
              </div>
            </div>
            <div className="rule-note">
              <Settings2 size={19} />
              <p>
                <strong>为什么这样安排？</strong>
                {!previous
                  ? "这是你的首次训练，完成后会根据实际表现调整下次计划。"
                  : draft.some((exercise) =>
                        lastExercise(state.sessions, exercise.catalogId),
                      )
                    ? "参考你过去完成的动作、常用器械和今天的时间安排；有记录的动作会显示上次表现供你参考。"
                    : "根据你的常用器械和今天的时间安排；这些动作还没有历史记录，先建立训练起点。"}
                {recovery
                  ? " 本次会适当减少训练量，重量可在热身后重新选择。"
                  : ""}
                {recommendation.gap !== null && recommendation.gap < 2
                  ? " 近期刚训练过，可换部位或减少组数。"
                  : ""}
              </p>
            </div>
            <p className="helper">
              先做 5–10
              分钟热身和动作递增组。以下只记录工作组；首次选重以能控制、保留约
              2–3 次余力为参考。
            </p>
            {state.profile.limits && (
              <p className="warning">
                已记录限制：{state.profile.limits}
                。请根据现场情况调整或跳过相关动作，这些限制仍需你自行确认。
              </p>
            )}
            <div className="plan-list">
              {draft.map((e, i) => (
                <PlanExercise
                  key={e.id}
                  e={e}
                  index={i}
                  sessions={state.sessions}
                  equipment={state.profile!.equipment}
                  busy={false}
                  onChange={(next) =>
                    setDraft((d) => d.map((x) => (x.id === e.id ? next : x)))
                  }
                />
              ))}
            </div>
            <p className="helper">
              完成主要工作组即可，不必为填满时间强行做满。更改部位、时长或复训模式会重新生成候选计划。
            </p>
            <div className="action-dock">
              <div>
                <b>计划 {draft.filter((e) => !e.skipped).length} 个动作</b>
                <span>
                  {draft
                    .filter((e) => !e.skipped)
                    .reduce((n, e) => n + e.sets.length, 0)}{" "}
                  组
                </span>
              </div>
              <Button
                disabled={
                  busy || !draft.some((e) => !e.skipped && e.sets.length)
                }
                onClick={() => void start()}
              >
                开始记录
                <Play size={18} />
              </Button>
            </div>
          </>
        ) : page === "workout" && running ? (
          <>
            <WorkoutIntroduction
              beginner={state.profile.experience === "刚开始"}
              hasRecordedTraining={state.sessions.some(
                (s) => s.source === "app" && stats(s).sets > 0,
              )}
            />
            <Workout
              session={running}
              sessions={state.sessions}
              busy={busy}
              focus={focus}
              setFocus={setFocus}
              update={(fn) => updateSession(running.id, fn)}
              onFinish={async (note) => {
                if (
                  await updateSession(running.id, (s) =>
                    finishSession({ ...s, note }),
                  )
                ) {
                  setSelected(running.id);
                  goDetail();
                }
              }}
              onDiscard={async () => {
                if (
                  await updateSession(running.id, (s) => ({
                    ...resumeSession(s),
                    status: "discarded",
                    endedAt: new Date().toISOString(),
                    restUntil: null,
                  }))
                ) {
                  go("home");
                  setNotice(
                    "本节已放弃，不计入训练历史和建议。已记录内容保留在数据导出中。",
                  );
                }
              }}
              back={() => go("home")}
              equipment={state.profile.equipment}
            />
          </>
        ) : page === "history" ? (
          <HistoryView sessions={state.sessions} onSelect={showSession} />
        ) : page === "summary" && session ? (
          <Summary
            key={session.id}
            profile={state.profile}
            session={session}
            sessions={state.sessions}
            back={() => go("history")}
          />
        ) : page === "settings" ? (
          <>
            <PageTitle title="训练偏好" />
            <ProfileForm
              profile={state.profile}
              busy={busy}
              onSave={async (p) => {
                if (await save((s) => ({ ...s, profile: p })))
                  setNotice("训练偏好已保存，下次制定计划时生效。");
              }}
            />
            <ReminderPreferences />
            <details className="settings-data">
              <summary>
                数据管理
                <ChevronDown size={16} />
              </summary>
              <p className="helper">备份记录、换设备，或导入以前的训练数据。</p>
              <DataTools
                state={state}
                save={save}
                busy={busy}
                notify={setNotice}
              />
            </details>
            <details className="settings-copy">
              <summary>
                关于与隐私
                <ChevronDown size={16} />
              </summary>
              <p>TrainTrace V1.3 · 发布候选版</p>
              <p>
                记录仅保存在当前浏览器的本站点中，不会同步到其他设备。清理浏览器数据或更换设备前，请先在「数据管理」中导出备份。
              </p>
              <p>
                {localAnalysisEnabled()
                  ? "仅在你点击详细 AI 分析时，必要的训练记录和偏好才会发送至 DeepSeek 官方服务。"
                  : "网页版使用本地规则反馈，不提供在线 AI 分析，也不会上传训练记录。"}
              </p>
              <h3>添加到主屏幕</h3>
              <p>
                iPhone：Safari 分享 → 添加到主屏幕。Android：浏览器菜单 →
                安装应用。电脑：Chrome 或 Edge
                菜单中选择安装此网站为应用，也可创建快捷方式。首次在线加载完成后，可离线记录。
              </p>
            </details>
            <details className="usage-guide">
              <summary>
                使用指南
                <ChevronDown size={16} />
              </summary>
              <h3>如何开始训练</h3>
              <p>
                在首页点击「开始训练」，确认今天的动作和组数，再点击「开始记录」。有未完成训练时，先选择继续。
              </p>
              <h3>如何记录重量和次数</h3>
              <p>
                完成动作后，确认本组重量和次数，点击完成。记录会自动保存；还有待做组时会开始休息计时。
              </p>
              <h3>如何修改当天训练计划</h3>
              <p>
                在「今天，怎么练」调整部位、时间、轻量恢复或动作。这些调整只影响本次计划。
              </p>
              <h3>如何调整长期训练偏好</h3>
              <p>
                从首页「偏好设置」或底部「设置」进入，修改后点击「保存训练偏好」，下次制定计划时生效。
              </p>
              <button
                className="text-button"
                onClick={() => setReplayGuide(true)}
              >
                重新查看新手引导
              </button>
            </details>
          </>
        ) : (
          <div className="empty">
            <h2>暂无进行中的训练</h2>
            <Button onClick={() => go("home")}>返回训练首页</Button>
          </div>
        )}
      </main>
      {state.profile && page !== "workout" && page !== "plan" && (
        <nav className="bottom-nav" aria-label="主导航">
          {(
            [
              { p: "home", name: "训练", icon: Home },
              { p: "history", name: "记录", icon: BarChart3 },
              { p: "settings", name: "设置", icon: Settings2 },
            ] as const
          ).map(({ p, name, icon: Icon }) => (
            <button
              key={p}
              aria-current={page === p ? "page" : undefined}
              className={page === p ? "active" : ""}
              onClick={() => go(p)}
            >
              <Icon size={21} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
      )}
      {needRefresh && (
        <div className="notice" role="status">
          <span>新版本已准备好，训练结束后可刷新更新，已保存记录会保留。</span>
          <button
            className="text-button"
            disabled={busy || !!running}
            onClick={() => void updateServiceWorker(true)}
          >
            刷新使用新版本
          </button>
          <button className="text-button" onClick={() => setNeedRefresh(false)}>
            稍后更新
          </button>
        </div>
      )}
      <div className="save-state" role="status">
        {busy ? "正在保存…" : state.revision > 0 ? "已存入此设备" : ""}
      </div>
    </div>
  );
}
const restLabel = (n: number) => `${Math.floor(n / 60)} 分 ${n % 60} 秒`;
function RestSettings({
  value,
  defaultOnly = false,
  onSave,
  onClose,
}: {
  value: number;
  defaultOnly?: boolean;
  onSave: (
    seconds: number,
    remember: boolean,
  ) => boolean | void | Promise<boolean | void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [minutes, setMinutes] = useState(String(Math.floor(value / 60))),
    [seconds, setSeconds] = useState(String(value % 60));
  const [remember, setRemember] = useState(true),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const m = Number(minutes),
      sec = Number(seconds),
      total = m * 60 + sec;
    if (
      minutes === "" ||
      seconds === "" ||
      !Number.isInteger(m) ||
      !Number.isInteger(sec) ||
      m < 0 ||
      sec < 0 ||
      sec > 59 ||
      total < 1 ||
      total > 3600
    ) {
      setError("请输入有效时间：1 秒至 60 分钟，秒数为 0–59。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if ((await onSave(total, defaultOnly || remember)) !== false) onClose();
    } catch {
      setError("休息时间未保存，请重试。");
    } finally {
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="rest-settings"
      aria-labelledby="rest-settings-title"
      onCancel={onClose}
    >
      <form onSubmit={submit}>
        <div className="section-heading">
          <h2 id="rest-settings-title">设置休息时间</h2>
          <button type="button" aria-label="关闭休息设置" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="rest-duration-fields">
          <label>
            分钟
            <input
              aria-label="休息分钟"
              type="number"
              inputMode="numeric"
              min="0"
              max="60"
              step="1"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            秒
            <input
              aria-label="休息秒数"
              type="number"
              inputMode="numeric"
              min="0"
              max="59"
              step="1"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
            />
          </label>
        </div>
        <div className="rest-presets">
          {[90, 120, 180].map((n) => (
            <button
              type="button"
              key={n}
              onClick={() => {
                setMinutes(String(Math.floor(n / 60)));
                setSeconds(String(n % 60));
              }}
            >
              {restLabel(n)}
            </button>
          ))}
        </div>
        {!defaultOnly && (
          <label className="rest-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            用作以后训练的默认时长
          </label>
        )}
        {!defaultOnly && (
          <p className="helper">本轮从开始休息时计算，已过去的时间不会重置。</p>
        )}
        {error && <p role="alert">{error}</p>}
        <Button type="submit" disabled={saving}>
          {saving ? "正在保存…" : "保存休息时间"}
        </Button>
      </form>
    </dialog>
  );
}
function ReminderPreferences() {
  const [preferences, setPreferences] = useState(readGuidance);
  const [restOpen, setRestOpen] = useState(false);
  function change(key: "sound" | "vibration", value: boolean) {
    saveGuidance({ [key]: value });
    setPreferences(readGuidance());
    if (key === "sound" && value) unlockRestAudio();
  }
  return (
    <section className="reminder-preferences" aria-labelledby="reminder-title">
      <h2 id="reminder-title">休息与提示</h2>
      <button className="rest-preference" onClick={() => setRestOpen(true)}>
        <span>
          默认组间休息
          <small>
            {preferences.defaultRest === null
              ? "按动作推荐"
              : restLabel(preferences.defaultRest)}
          </small>
        </span>
        <ChevronRight size={18} />
      </button>
      {restOpen && (
        <RestSettings
          value={preferences.defaultRest ?? 120}
          defaultOnly
          onClose={() => setRestOpen(false)}
          onSave={(seconds) => {
            saveGuidance({ defaultRest: seconds });
            setPreferences(readGuidance());
            return true;
          }}
        />
      )}
      <label>
        <span>
          休息提示音<small>结束时双音，跳过时轻响。</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={preferences.sound}
          onChange={(e) => change("sound", e.target.checked)}
        />
      </label>
      <label>
        <span>
          休息结束震动<small>在支持震动的设备上提醒。</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={preferences.vibration}
          onChange={(e) => change("vibration", e.target.checked)}
        />
      </label>
      <p className="helper">
        提示受设备静音、音量和浏览器权限限制，页面始终保留倒计时。
      </p>
    </section>
  );
}
function ImmersiveOnboarding({
  initialStep,
  replay,
  onStep,
  onComplete,
}: {
  initialStep: number;
  replay: boolean;
  onStep: (step: number) => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState(Math.min(initialStep, 2));
  const [leaving, setLeaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const locked = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const screens = [
    {
      theme: "ink",
      title: ["每一次训练，", "都不该", "从零开始。"],
      caption: ["记住你的重量、次数与每一次进步。"],
    },
    {
      theme: "paper",
      title: ["练完一组，", "点一下", "就够。"],
      caption: ["记录自动保存，", "休息计时随即开始。"],
    },
    {
      theme: "green",
      title: ["下一次，", "比上一次", "更懂你。"],
      caption: ["根据真实训练记录，", "持续调整训练建议。"],
    },
  ];
  const screen = screens[step];
  function advance() {
    // Lock synchronously: even taps in the same event turn cannot skip a screen.
    if (locked.current) return;
    locked.current = true;
    setTransitioning(true);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (step === 2) {
      if (reduced) onComplete();
      else {
        setLeaving(true);
        timers.current.push(setTimeout(onComplete, 400));
      }
      return;
    }
    const showNext = () => {
      setStep(step + 1);
      onStep(step + 1);
      setLeaving(false);
    };
    if (reduced) showNext();
    else {
      setLeaving(true);
      timers.current.push(setTimeout(showNext, 160));
    }
    timers.current.push(
      setTimeout(
        () => {
          locked.current = false;
          setTransitioning(false);
          timers.current = [];
        },
        reduced ? 180 : 400,
      ),
    );
  }
  return (
    <section
      className={`immersive-guide guide-${screen.theme}`}
      aria-label="新手引导"
      data-transitioning={transitioning}
    >
      <div
        className={`guide-copy${leaving ? " leaving" : ""}`}
        aria-live="polite"
        aria-atomic="true"
      >
        <h1 id="guide-title">
          {screen.title.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h1>
        <p id="guide-caption">
          {screen.caption.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </p>
      </div>
      <div className="guide-footer">
        <p id="guide-count">{String(step + 1).padStart(2, "0")} / 03</p>
        <p>
          {step < 2
            ? "点击任意位置继续"
            : replay
              ? "点击任意位置返回设置"
              : "点击任意位置开始设置"}
        </p>
      </div>
      <button
        type="button"
        className="guide-next"
        disabled={transitioning}
        aria-label={step < 2 ? "下一屏" : replay ? "返回设置" : "开始设置"}
        aria-describedby="guide-title guide-caption guide-count"
        onClick={advance}
      />
      <button
        type="button"
        className="guide-skip"
        aria-label="跳过新手引导"
        disabled={transitioning}
        onClick={() => {
          if (!locked.current) {
            locked.current = true;
            onComplete();
          }
        }}
      >
        跳过
      </button>
    </section>
  );
}
function WorkoutIntroduction({
  beginner,
  hasRecordedTraining,
}: {
  beginner: boolean;
  hasRecordedTraining: boolean;
}) {
  const [visible, setVisible] = useState(
    () => !hasRecordedTraining && !readGuidance().workoutHintSeen,
  );
  useEffect(() => {
    if (visible) saveGuidance({ workoutHintSeen: true });
  }, [visible]);
  if (!visible) return null;
  return (
    <section
      className="workout-introduction"
      aria-labelledby="workout-help-title"
    >
      <div className="section-heading">
        <h2 id="workout-help-title">如何记录一组训练？</h2>
        <button className="text-button" onClick={() => setVisible(false)}>
          知道了
        </button>
      </div>
      <p>
        完成动作后，确认重量和次数，点击完成本组，系统会自动保存并开始休息计时。
      </p>
      {beginner && <p>第一次训练，先选择能够稳定控制的重量。</p>}
    </section>
  );
}
function Onboarding({
  busy,
  onSave,
  importView,
}: {
  busy: boolean;
  onSave: (p: Profile) => void;
  importView: ReactNode;
}) {
  return (
    <>
      <section className="welcome">
        <h1>先了解一下你的训练习惯。</h1>
        <p>这些设置以后都可以修改。</p>
      </section>
      <ProfileForm busy={busy} onSave={onSave} />
      <details className="import-existing">
        <summary>
          已经有训练数据？直接导入
          <ChevronDown size={16} />
        </summary>
        {importView}
      </details>
    </>
  );
}
const defaultProfile: Profile = {
  goal: "增肌",
  experience: "有一定经验",
  frequency: 3,
  equipment: ["杠铃", "哑铃", "固定器械", "自重"],
  preference: "均衡",
  limits: "",
};
function ProfileForm({
  profile,
  busy,
  onSave,
}: {
  profile?: Profile;
  busy: boolean;
  onSave: (p: Profile) => void;
}) {
  const [p, setP] = useState<Profile>(profile ?? defaultProfile);
  const field = <K extends keyof Profile>(k: K, v: Profile[K]) =>
    setP((p) => ({ ...p, [k]: v }));
  return (
    <form
      className="profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(p);
      }}
    >
      <fieldset>
        <legend>想要的改变</legend>
        <div className="choice-grid">
          {["增肌", "力量提升", "减脂期维持", "建立习惯"].map((g) => (
            <button
              type="button"
              key={g}
              aria-pressed={p.goal === g}
              className={p.goal === g ? "chosen" : ""}
              onClick={() => field("goal", g as Profile["goal"])}
            >
              {g}
              {p.goal === g && <Check size={16} />}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="form-pair">
        <label>
          训练经验
          <select
            value={p.experience}
            onChange={(e) =>
              field("experience", e.target.value as Profile["experience"])
            }
          >
            <option>刚开始</option>
            <option>有一定经验</option>
            <option>规律训练</option>
          </select>
        </label>
        <label>
          每周训练
          <select
            value={p.frequency}
            onChange={(e) => field("frequency", +e.target.value)}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n} 次
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend>
          常用器械 <span>可多选</span>
        </legend>
        <div className="choice-grid equipment">
          {gears.map((g) => (
            <button
              type="button"
              key={g}
              aria-pressed={p.equipment.includes(g)}
              className={p.equipment.includes(g) ? "chosen" : ""}
              onClick={() =>
                field(
                  "equipment",
                  p.equipment.includes(g)
                    ? p.equipment.filter((x) => x !== g)
                    : [...p.equipment, g],
                )
              }
            >
              {g}
              {p.equipment.includes(g) && <Check size={16} />}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        训练节奏
        <select
          value={p.preference}
          onChange={(e) =>
            field("preference", e.target.value as Profile["preference"])
          }
        >
          <option value="均衡">均衡 · 稳定积累</option>
          <option value="精简">精简 · 较少工作组</option>
          <option value="保守">保守 · 重新选重</option>
        </select>
      </label>
      <details>
        <summary>
          动作偏好或限制（选填）
          <Plus size={16} />
        </summary>
        <label>
          <span className="sr-only">动作偏好或限制</span>
          <textarea
            placeholder="例如：不喜欢杠铃深蹲；今天肩部不适。候选计划仍需你自主确认。"
            value={p.limits}
            maxLength={1000}
            onChange={(e) => field("limits", e.target.value)}
          />
        </label>
      </details>
      <Button type="submit" disabled={busy || !p.equipment.length}>
        {profile ? "保存训练偏好" : "准备好了，开始训练"}
        <ArrowRight size={18} />
      </Button>
      <p className="privacy">
        <ShieldCheck size={14} />
        无需账号 · 默认本地保存
      </p>
    </form>
  );
}
function PlanExercise({
  e,
  index,
  sessions,
  equipment,
  onChange,
  busy,
}: {
  e: Exercise;
  index: number;
  sessions: Session[];
  equipment: Profile["equipment"];
  onChange: (e: Exercise) => void | Promise<boolean>;
  busy: boolean;
}) {
  const previous = lastExercise(sessions, e.catalogId),
    [replace, setReplace] = useState(false),
    [restOpen, setRestOpen] = useState(false);
  const replacements = catalog.filter(
    (m) =>
      m.theme === catalog.find((m) => m.id === e.catalogId)?.theme &&
      equipment.includes(m.equipment) &&
      m.id !== e.catalogId,
  );
  return (
    <article className={`plan-exercise ${e.skipped ? "skipped" : ""}`}>
      <div className="exercise-heading">
        <span className="exercise-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div>
          <h2>{e.name}</h2>
          <p>
            {e.basis} · {e.sets.length} 组 ·{" "}
            <button
              className="rest-inline"
              type="button"
              onClick={() => setRestOpen(true)}
              disabled={busy}
            >
              休息 {restLabel(e.rest)}
            </button>
          </p>
        </div>
        <button
          className="text-button"
          disabled={busy || completed(e).length > 0}
          onClick={() => onChange({ ...e, skipped: !e.skipped })}
        >
          {e.skipped ? "恢复" : "跳过"}
        </button>
      </div>
      {restOpen && (
        <RestSettings
          value={e.rest}
          onClose={() => setRestOpen(false)}
          onSave={async (seconds, remember) => {
            const ok = await onChange({ ...e, rest: seconds });
            if (ok === false) return false;
            if (remember) saveGuidance({ defaultRest: seconds });
            return true;
          }}
        />
      )}
      {!e.skipped && (
        <>
          <div className="history-reference">
            上次
            {previous ? (
              <>
                {" "}
                · {date(previous.session.startedAt)}
                <br />
                <SetLine e={previous.exercise} />
              </>
            ) : (
              <> · 暂无记录，热身后现场选重</>
            )}
          </div>
          <div className="plan-set-head">
            <span>工作组</span>
            <span>重量 kg</span>
            <span>次数</span>
          </div>
          {e.sets.map((s, i) => (
            <div className="plan-set" key={s.id}>
              <span>{i + 1}</span>
              <input
                aria-label={`${e.name} 第${i + 1}组重量`}
                type="number"
                inputMode="decimal"
                min="0"
                max="1000"
                step="0.5"
                placeholder="选重"
                value={s.weight ?? ""}
                disabled={busy || !!s.actual || e.basis === "自重"}
                onChange={(event) => {
                  const n =
                    event.target.value === "" ? null : +event.target.value;
                  if (n === null || (Number.isFinite(n) && n >= 0 && n <= 1000))
                    onChange({
                      ...e,
                      sets: e.sets.map((t) =>
                        t.id === s.id
                          ? { ...t, weight: n, draftEdited: true }
                          : t,
                      ),
                    });
                }}
              />
              <input
                aria-label={`${e.name} 第${i + 1}组次数`}
                type="number"
                inputMode="numeric"
                min="1"
                max="200"
                value={s.reps}
                disabled={busy || !!s.actual}
                onChange={(event) => {
                  const n = +event.target.value;
                  if (Number.isInteger(n) && n >= 1 && n <= 200)
                    onChange({
                      ...e,
                      sets: e.sets.map((t) =>
                        t.id === s.id
                          ? { ...t, reps: n, draftEdited: true }
                          : t,
                      ),
                    });
                }}
              />
            </div>
          ))}
          <div className="exercise-actions">
            <button
              disabled={busy || e.sets.length <= 1 || !!e.sets.at(-1)?.actual}
              onClick={() => onChange({ ...e, sets: e.sets.slice(0, -1) })}
            >
              <Minus size={16} />
              减少组数
            </button>
            <button
              disabled={busy || completed(e).length > 0}
              onClick={() => setReplace(!replace)}
            >
              <RefreshCw size={15} />
              替换动作
            </button>
          </div>
          {replace && (
            <div className="replacement">
              <label>
                选择同部位动作
                <select
                  aria-label={`替换${e.name}`}
                  defaultValue=""
                  onChange={(event) => {
                    const m = catalog.find((m) => m.id === event.target.value);
                    if (m) {
                      onChange({
                        ...makeExercise(m, sessions, e.sets.length),
                        rest: e.rest,
                      });
                      setReplace(false);
                    }
                  }}
                >
                  <option value="" disabled>
                    选择动作…
                  </option>
                  {replacements.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.equipment}
                    </option>
                  ))}
                </select>
              </label>
              <p className="helper">
                更换后独立引用该动作历史，请确认现场器械与动作模式适合。
              </p>
            </div>
          )}
        </>
      )}
    </article>
  );
}
function Workout({
  session,
  sessions,
  busy,
  focus,
  setFocus,
  update,
  onFinish,
  onDiscard,
  back,
  equipment,
}: {
  session: Session;
  sessions: Session[];
  busy: boolean;
  focus: number;
  setFocus: (i: number) => void;
  update: (fn: (s: Session) => Session) => Promise<boolean>;
  onFinish: (note: string) => Promise<void>;
  onDiscard: () => Promise<void>;
  back: () => void;
  equipment: Profile["equipment"];
}) {
  const [now, setNow] = useState(Date.now()),
    [end, setEnd] = useState(false),
    [note, setNote] = useState(session.note),
    [edit, setEdit] = useState(false),
    [feedback, setFeedback] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [restOpen, setRestOpen] = useState<string | null | false>(false);
  const e = session.exercises[Math.min(focus, session.exercises.length - 1)],
    nextSet = e?.sets.find((s) => !s.actual),
    activeSet = nextSet,
    previous = e ? lastExercise(sessions, e.catalogId) : undefined;
  const rest = Math.max(0, Math.ceil(((session.restUntil ?? 0) - now) / 1000)),
    elapsed = trainingSeconds(session, now),
    paused = !!session.timing?.pausedAt;

  const hasNextSet = session.exercises.some(
    (exercise) => !exercise.skipped && exercise.sets.some((set) => !set.actual),
  );
  const lastCompletedSet = session.exercises
    .flatMap((exercise) => exercise.sets)
    .filter((set) => set.actual)
    .reduce<TrainingSet | undefined>(
      (latest, set) =>
        !latest ||
        Date.parse(set.actual!.completedAt) >=
          Date.parse(latest.actual!.completedAt)
          ? set
          : latest,
      undefined,
    );
  const restDuration =
    session.restUntil && lastCompletedSet
      ? Math.max(
          1,
          session.restUntil - Date.parse(lastCompletedSet.actual!.completedAt),
        )
      : 1;
  const restProgress = Math.max(
    0,
    Math.min(100, (((session.restUntil ?? 0) - now) / restDuration) * 100),
  );
  const notifiedRest = useRef<string | null>(null);
  const endPanel = useRef<HTMLElement>(null);
  const endActions = useRef<HTMLDivElement>(null);
  function revealEndPanel() {
    // Instant scrolling avoids motion and runs only once the panel exists.
    endPanel.current?.scrollIntoView({ block: "start", behavior: "instant" });
    endActions.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
  }
  useLayoutEffect(() => {
    if (end) revealEndPanel();
  }, [end]);
  useEffect(() => {
    window.addEventListener("pointerdown", unlockRestAudio);
    window.addEventListener("keydown", unlockRestAudio);
    const refreshClock = () => setNow(Date.now());
    const timer = setInterval(refreshClock, 500);
    document.addEventListener("visibilitychange", refreshClock);
    window.addEventListener("pageshow", refreshClock);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", unlockRestAudio);
      window.removeEventListener("keydown", unlockRestAudio);
      document.removeEventListener("visibilitychange", refreshClock);
      window.removeEventListener("pageshow", refreshClock);
    };
  }, []);
  useEffect(() => {
    if (
      !session.restUntil ||
      now < session.restUntil ||
      !hasNextSet ||
      !lastCompletedSet ||
      document.visibilityState !== "visible"
    )
      return;
    const cycle = `${lastCompletedSet.id}:${session.restUntil}`;
    if (notifiedRest.current === cycle) return;
    notifiedRest.current = cycle;
    // UI-only acknowledgement survives refresh; training facts stay in IndexedDB.
    try {
      const key = `traintrace-rest-notified:${session.id}`;
      if (sessionStorage.getItem(key) === cycle) return;
      sessionStorage.setItem(key, cycle);
    } catch {
      /* Storage restrictions must not interrupt recording. */
    }
    // A stale deadline is a visual result, never a delayed alarm.
    if (now - session.restUntil > 3000) return;
    playRestCue("complete");
    try {
      if (readGuidance().vibration && typeof navigator.vibrate === "function")
        navigator.vibrate([200, 120, 200]);
    } catch {
      /* The persistent visual notice is the fallback. */
    }
  }, [now, session.restUntil, session.id, hasNextSet, lastCompletedSet?.id]);
  useEffect(() => {
    setEdit(false);
    setFeedback(null);
    setMessage("");
  }, [e?.id]);
  async function record(weight: number | null, reps: number) {
    if (!activeSet || !e) return;
    const ok = await update((s) => {
      const current = s.exercises.find((x) => x.id === e.id),
        target = current?.sets.find((t) => t.id === activeSet.id);
      if (
        !current ||
        current.skipped ||
        !target ||
        target.actual ||
        s.status !== "active"
      )
        return s;
      const prepared = {
        ...s,
        exercises: s.exercises.map((x) =>
          x.id === e.id
            ? {
                ...x,
                sets: x.sets.map((t) =>
                  t.id === activeSet.id ? { ...t, weight, reps } : t,
                ),
              }
            : x,
        ),
      };
      return completeSet(prepared, e.id, activeSet.id);
    });
    if (ok) {
      setNow(Date.now());
      setMessage(
        `第 ${e.sets.findIndex((t) => t.id === activeSet.id) + 1} 组已记录`,
      );
      if (e.main && e.sets.filter((t) => !t.actual).length === 1)
        setFeedback(activeSet.id);
    }
  }
  const updateExercise = (next: Exercise) =>
    update((s) => {
      const changed = {
        ...s,
        exercises: s.exercises.map((x) => {
          if (x.id !== e.id) return x;
          if (JSON.stringify(x) !== JSON.stringify(e))
            throw Error("动作已在另一处更新，请重新打开当前动作");
          return next;
        }),
      };
      return next.rest !== e.rest
        ? changeRestDuration(changed, next.rest, e.id)
        : changed;
    });
  const lastSet = e?.sets.find((s) => s.id === feedback);
  return (
    <>
      <PageTitle
        title={`${session.theme}训练`}
        back={back}
        aside={
          <span className="session-time" role="timer" aria-label="训练用时">
            <Clock3 size={15} />
            {Math.floor(elapsed / 60)
              .toString()
              .padStart(2, "0")}
            :{(elapsed % 60).toString().padStart(2, "0")}
          </span>
        }
      />
      <div className="workout-context">
        <span>
          <span className="status-dot" />
          {paused ? "计时已暂停" : "正在记录"}
        </span>
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            void update((s) =>
              s.timing?.pausedAt ? resumeSession(s) : pauseSession(s),
            )
          }
        >
          {paused ? "恢复计时" : "暂停计时"}
        </button>
        <button className="text-button" onClick={() => setEnd(!end)}>
          <Flag size={16} />
          结束训练
        </button>
      </div>
      {paused && (
        <p className="helper" role="status">
          训练计时已暂停；组间休息仍继续倒计时。恢复计时后可继续记组。
        </p>
      )}
      {end && (
        <section
          className="end-panel"
          ref={endPanel}
          aria-labelledby="end-training-title"
        >
          <h2 id="end-training-title">结束这节训练？</h2>
          <p>
            将保存已完成的 {stats(session).sets}{" "}
            组。未完成计划不会计入实际记录。
          </p>
          <label className="session-note">
            训练后感受（选填）
            <textarea
              aria-label="训练后感受"
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：最后两次吃力，下次先保持。"
              onBlur={(event) => {
                if (!(
                  event.relatedTarget instanceof HTMLElement &&
                  event.relatedTarget.closest(".end-panel")
                ))
                  void update((s) => ({ ...s, note: event.target.value }));
              }}
            />
          </label>
          <div className="button-row" ref={endActions}>
            <Button
              disabled={busy || stats(session).sets === 0}
              onClick={() => void onFinish(note)}
            >
              结束并查看总结
            </Button>
            <Button
              kind="secondary"
              onClick={() => {
                void update((s) => ({ ...s, note }));
                setEnd(false);
              }}
            >
              继续训练
            </Button>
          </div>
          <details>
            <summary>
              放弃本节训练
              <ChevronDown size={15} />
            </summary>
            <p>不计入训练历史与建议；已完成内容仍保留在导出备份中。</p>
            <Button
              kind="danger"
              disabled={busy}
              onClick={() => void onDiscard()}
            >
              <Trash2 size={16} />
              确认放弃本节
            </Button>
          </details>
        </section>
      )}
      <div className="exercise-tabs" aria-label="训练动作">
        {session.exercises.map((x, i) => (
          <button
            key={x.id}
            aria-pressed={i === focus}
            className={i === focus ? "active" : ""}
            onClick={() => setFocus(i)}
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            {x.name}
            {x.skipped ? (
              <SkipForward size={14} />
            ) : completed(x).length === x.sets.length ? (
              <Check size={14} />
            ) : null}
          </button>
        ))}
      </div>
      {e && (
        <section className="workout-main">
          <div className="workout-heading">
            <div>
              <p>
                {e.basis} ·{" "}
                <button
                  className="rest-inline"
                  disabled={busy}
                  onClick={() => setRestOpen(e.id)}
                >
                  休息 {restLabel(e.rest)}
                </button>
              </p>
              <h2>{e.name}</h2>
            </div>
            <button
              className="icon-button"
              aria-label="调整当前动作"
              onClick={() => setEdit(!edit)}
            >
              <Settings2 size={21} />
            </button>
          </div>
          <p className="movement-tip">
            {catalog.find((m) => m.id === e.catalogId)?.tip}
          </p>
          <div className="previous-performance">
            <History size={17} />
            <div>
              <span>
                上次实际表现
                {previous ? ` · ${date(previous.session.startedAt)}` : ""}
              </span>
              <p>
                {previous ? (
                  <SetLine e={previous.exercise} />
                ) : (
                  <>暂无记录，本次建立基线</>
                )}
              </p>
            </div>
          </div>
          <div className="set-table">
            <div className="set-table-head">
              <span>组</span>
              <span>重量 kg</span>
              <span>次数</span>
              <span>状态</span>
            </div>
            {e.sets.map((s, i) => (
              <div
                className={`set-row ${s.actual ? "done" : s.id === activeSet?.id && !e.skipped ? "current" : ""}`}
                key={s.id}
              >
                <span>{i + 1}</span>
                <b>
                  {s.actual
                    ? fmt(s.actual.weight)
                    : s.weight === null
                      ? "—"
                      : fmt(s.weight)}
                </b>
                <b>{s.actual ? s.actual.reps : s.reps}</b>
                <span>
                  {s.actual ? (
                    <>
                      <Check size={16} />
                      <span className="sr-only">已完成</span>
                    </>
                  ) : e.skipped ? (
                    "跳过"
                  ) : s.id === activeSet?.id ? (
                    "当前"
                  ) : (
                    "待做"
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="set-management">
            <button
              className="text-button"
              disabled={busy || e.skipped || e.sets.length >= 20}
              onClick={() =>
                updateExercise({
                  ...e,
                  sets: [
                    ...e.sets,
                    {
                      ...e.sets.at(-1)!,
                      id: uid(),
                      actual: null,
                      draftEdited: false,
                    },
                  ],
                })
              }
            >
              <Plus size={16} />
              新增一组
            </button>
            <button
              className="text-button"
              disabled={busy || e.sets.length <= 1 || !!e.sets.at(-1)?.actual}
              onClick={() =>
                updateExercise({ ...e, sets: e.sets.slice(0, -1) })
              }
            >
              <Minus size={16} />
              删除末尾待做组
            </button>
          </div>
          {edit && (
            <div className="inline-adjust">
              <h3>调整当前动作</h3>
              <PlanExercise
                e={e}
                index={focus}
                sessions={sessions}
                equipment={equipment}
                onChange={updateExercise}
                busy={busy}
              />
              <button
                className="text-button rest-inline"
                disabled={busy}
                onClick={() => setRestOpen(e.id)}
              >
                组间休息 · {restLabel(e.rest)}
                <Settings2 size={16} />
              </button>
              <Button kind="secondary" onClick={() => setEdit(false)}>
                收起调整
              </Button>
            </div>
          )}
          {feedback && lastSet?.actual && (
            <section className="effort" aria-label="本动作感受">
              <div className="section-heading">
                <h3>这个动作，感觉如何？</h3>
                <button
                  className="text-button"
                  onClick={() => setFeedback(null)}
                >
                  跳过
                  <X size={15} />
                </button>
              </div>
              <div className="effort-options">
                {(["挺轻松", "刚刚好", "很吃力"] as const).map((feeling) => (
                  <button
                    key={feeling}
                    aria-pressed={lastSet.actual?.feeling === feeling}
                    className={
                      lastSet.actual?.feeling === feeling ? "chosen" : ""
                    }
                    disabled={busy}
                    onClick={() =>
                      void update((s) => ({
                        ...s,
                        exercises: s.exercises.map((x) =>
                          x.id === e.id
                            ? {
                                ...x,
                                sets: x.sets.map((t) =>
                                  t.id === feedback && t.actual
                                    ? { ...t, actual: { ...t.actual, feeling } }
                                    : t,
                                ),
                              }
                            : x,
                        ),
                      }))
                    }
                  >
                    {lastSet.actual?.feeling === feeling && <Check size={18} />}
                    {feeling}
                  </button>
                ))}
              </div>
              <p className="effort-saved" role="status">
                {lastSet.actual.feeling
                  ? `已记录：${lastSet.actual.feeling}。可以继续下个动作。`
                  : "选填，点一下即可；也可以直接继续。"}
              </p>
              <details>
                <summary>
                  记录准确 RPE（选填）
                  <Plus size={15} />
                </summary>
                <label>
                  末组 RPE
                  <select
                    aria-label="末组 RPE"
                    disabled={busy}
                    value={lastSet.actual.rpe ?? ""}
                    onChange={(event) => {
                      const rpe = event.target.value
                        ? +event.target.value
                        : undefined;
                      void update((s) => ({
                        ...s,
                        exercises: s.exercises.map((x) =>
                          x.id === e.id
                            ? {
                                ...x,
                                sets: x.sets.map((t) =>
                                  t.id === feedback && t.actual
                                    ? { ...t, actual: { ...t.actual, rpe } }
                                    : t,
                                ),
                              }
                            : x,
                        ),
                      }));
                    }}
                  >
                    <option value="">不记录</option>
                    {[6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <p className="helper">
                  RPE 8 约为还能做 2 次。感受与 RPE 分开保存，不做强制换算。
                </p>
              </details>
            </section>
          )}
          {activeSet && !e.skipped ? (
            <SetEditor
              key={activeSet.id}
              set={activeSet}
              basis={e.basis}
              index={e.sets.findIndex((t) => t.id === activeSet.id) + 1}
              total={e.sets.length}
              busy={busy}
              paused={paused}
              resting={rest > 0}
              record={record}
              onDraft={(weight, reps) =>
                void update((s) => ({
                  ...s,
                  exercises: s.exercises.map((x) =>
                    x.id === e.id
                      ? {
                          ...x,
                          sets: x.sets.map((t) =>
                            t.id === activeSet.id && !t.actual
                              ? { ...t, weight, reps, draftEdited: true }
                              : t,
                          ),
                        }
                      : x,
                  ),
                }))
              }
            />
          ) : (
            <div className="exercise-complete">
              <Check size={28} />
              <h3>{e.skipped ? "本动作已跳过" : "这个动作已完成"}</h3>
              <p>{completed(e).length} 组实际记录已保存。</p>
              {session.exercises.some(
                (x, i) =>
                  i > focus && !x.skipped && x.sets.some((t) => !t.actual),
              ) ? (
                <Button
                  onClick={() =>
                    setFocus(
                      session.exercises.findIndex(
                        (x, i) =>
                          i > focus &&
                          !x.skipped &&
                          x.sets.some((t) => !t.actual),
                      ),
                    )
                  }
                >
                  下一个动作
                  <ArrowRight size={18} />
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    if (end) revealEndPanel();
                    else setEnd(true);
                  }}
                >
                  结束并查看总结
                  <Flag size={18} />
                </Button>
              )}
            </div>
          )}
          <p className="completion-message" role="status">
            {message}
          </p>
        </section>
      )}
      {restOpen !== false && (
        <RestSettings
          value={
            restOpen === null
              ? Math.round(restDuration / 1000)
              : (session.exercises.find((x) => x.id === restOpen)?.rest ??
                e.rest)
          }
          onClose={() => setRestOpen(false)}
          onSave={async (seconds, remember) => {
            const ok = await update((s) =>
              changeRestDuration(s, seconds, restOpen ?? undefined),
            );
            if (ok && remember) saveGuidance({ defaultRest: seconds });
            setNow(Date.now());
            return ok;
          }}
        />
      )}
      {session.restUntil !== null && hasNextSet ? (
        rest > 0 ? (
          <div className="rest-dock" role="timer" aria-label="组间休息">
            <button
              className="rest-time"
              aria-label="调整本轮休息时间"
              disabled={busy}
              onClick={() => setRestOpen(null)}
            >
              <span>组间休息 · 点此调整</span>
              <strong>
                {String(Math.floor(rest / 60)).padStart(2, "0")}
                <i>:</i>
                {String(rest % 60).padStart(2, "0")}
              </strong>
            </button>
            <progress
              className="rest-progress"
              aria-label="休息剩余进度"
              max={100}
              value={restProgress}
            />
            <button
              disabled={busy}
              onClick={() =>
                void update((s) => ({
                  ...s,
                  restUntil:
                    s.restUntil === null
                      ? null
                      : Math.max(s.restUntil, Date.now()) + 30000,
                }))
              }
            >
              +30 秒
            </button>
            <button
              aria-label="跳过休息"
              disabled={busy}
              onClick={() => {
                playRestCue("skip");
                void update((s) => ({ ...s, restUntil: null }));
              }}
            >
              跳过
              <SkipForward size={18} />
            </button>
          </div>
        ) : (
          <div className="rest-dock rest-complete" role="status">
            <Check size={27} />
            <div>
              <strong>休息结束，可以开始下一组</strong>
              <span>准备好后，继续记录下一组。</span>
            </div>
            <button
              aria-label="收起休息提示"
              disabled={busy}
              onClick={() => void update((s) => ({ ...s, restUntil: null }))}
            >
              <X size={19} />
            </button>
          </div>
        )
      ) : (
        <div className="workout-footer">
          <ShieldCheck size={15} />
          每次完成即保存，退出后可继续。
        </div>
      )}
    </>
  );
}
function SetEditor({
  set,
  basis,
  index,
  total,
  busy,
  paused,
  resting,
  record,
  onDraft,
}: {
  set: TrainingSet;
  basis: Exercise["basis"];
  index: number;
  total: number;
  busy: boolean;
  paused: boolean;
  resting: boolean;
  record: (w: number | null, r: number) => Promise<void>;
  onDraft: (w: number | null, r: number) => void;
}) {
  const [w, setW] = useState(set.weight === null ? "" : String(set.weight)),
    [r, setR] = useState(String(set.reps)),
    [validation, setValidation] = useState("");
  useEffect(() => {
    setW(set.weight === null ? "" : String(set.weight));
    setR(String(set.reps));
  }, [set.weight, set.reps]);
  function persist(weight: string, reps: string) {
    const wn = weight === "" ? null : +weight,
      rn = +reps;
    if (
      (wn === null || (Number.isFinite(wn) && wn >= 0 && wn <= 1000)) &&
      Number.isInteger(rn) &&
      rn >= 1 &&
      rn <= 200
    )
      onDraft(wn, rn);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const wn = w === "" ? null : +w,
      rn = +r;
    if (
      wn === null ||
      !Number.isFinite(wn) ||
      wn < 0 ||
      wn > 1000 ||
      !Number.isInteger(rn) ||
      rn < 1 ||
      rn > 200
    ) {
      setValidation("请输入重量（0–1000 kg）和次数（1–200）；自重为 0。");
      return;
    }
    setValidation("");
    void record(wn, rn);
  }
  return (
    <form className="set-editor" onSubmit={submit}>
      <div className="section-heading">
        <h3>
          第 <b>{index}</b> / {total} 组
        </h3>
        <span>预填参考 · 完成后才计入</span>
      </div>
      <div className="number-editors">
        <label>
          重量 <span>{basis === "自重" ? "自重 / 0 kg" : "kg"}</span>
          <div className="stepper">
            <button
              type="button"
              aria-label="减少重量"
              disabled={busy || paused || basis === "自重"}
              onClick={() => {
                const n = String(Math.max(0, (+w || 0) - 2.5));
                setW(n);
                persist(n, r);
              }}
            >
              <Minus size={20} />
            </button>
            <input
              aria-label="本组重量"
              type="number"
              inputMode="decimal"
              min="0"
              max="1000"
              step="any"
              placeholder="选重"
              value={w}
              disabled={paused || basis === "自重"}
              onChange={(event) => setW(event.target.value)}
              onBlur={(event) => {
                if (!(
                  event.relatedTarget instanceof HTMLElement &&
                  event.relatedTarget.closest(".set-editor")
                ))
                  persist(w, r);
              }}
            />
            <button
              type="button"
              aria-label="增加重量"
              disabled={busy || paused || basis === "自重"}
              onClick={() => {
                const n = String(Math.min(1000, (+w || 0) + 2.5));
                setW(n);
                persist(n, r);
              }}
            >
              <Plus size={20} />
            </button>
          </div>
        </label>
        <label>
          次数 <span>reps</span>
          <div className="stepper">
            <button
              type="button"
              aria-label="减少次数"
              disabled={busy || paused}
              onClick={() => {
                const n = String(Math.max(1, (+r || 1) - 1));
                setR(n);
                persist(w, n);
              }}
            >
              <Minus size={20} />
            </button>
            <input
              aria-label="本组次数"
              type="number"
              inputMode="numeric"
              disabled={paused}
              min="1"
              max="200"
              value={r}
              onChange={(event) => setR(event.target.value)}
              onBlur={(event) => {
                if (!(
                  event.relatedTarget instanceof HTMLElement &&
                  event.relatedTarget.closest(".set-editor")
                ))
                  persist(w, r);
              }}
            />
            <button
              type="button"
              aria-label="增加次数"
              disabled={busy || paused}
              onClick={() => {
                const n = String(Math.min(200, (+r || 0) + 1));
                setR(n);
                persist(w, n);
              }}
            >
              <Plus size={20} />
            </button>
          </div>
        </label>
      </div>
      {validation && (
        <p className="warning" role="alert">
          {validation}
        </p>
      )}
      <Button type="submit" disabled={busy || paused}>
        {paused
          ? "恢复计时后可记组"
          : busy
            ? "正在保存…"
            : `完成第 ${index} 组`}
        <Check size={22} />
      </Button>
      <p className="helper">
        {resting
          ? "休息计时中；准备好后仍可记录下一组。"
          : "实际表现有变化？改完数字，点击完成。"}
      </p>
    </form>
  );
}
function HistoryRow({ s, onClick }: { s: Session; onClick: () => void }) {
  const info = stats(s);
  return (
    <button className="history-row" onClick={onClick}>
      <span className="history-date">
        <b>{new Date(s.startedAt).getDate()}</b>
        <span>{new Date(s.startedAt).getMonth() + 1} 月</span>
      </span>
      <span className="history-description">
        <strong>{s.theme}训练</strong>
        <span>
          {info.exercises} 个动作 · {info.sets} 组
          {s.source === "app" ? ` · ${info.minutes} 分钟` : ""}
        </span>
      </span>
      <ChevronRight size={20} />
    </button>
  );
}
function HistoryView({
  sessions,
  onSelect,
}: {
  sessions: Session[];
  onSelect: (s: Session) => void;
}) {
  const [days, setDays] = useState(30),
    [filterDate, setFilterDate] = useState(""),
    [movement, setMovement] = useState(""),
    [metric, setMetric] = useState<"weight" | "volume">("weight");
  const history = finished(sessions),
    recent = history.filter(
      (s) => Date.now() - Date.parse(s.startedAt) < days * 86400000,
    ),
    names = [
      ...new Map(
        history.flatMap((s) =>
          s.exercises
            .filter((e) => completed(e).length)
            .map((e) => [
              movementIdentity(e),
              [e.name, e.variant, e.equipmentId].filter(Boolean).join(" · "),
            ]),
        ),
      ).entries(),
    ];
  const movementId = movement || names[0]?.[0],
    points = history
      .flatMap((s) => {
        const e = s.exercises.find(
          (e) => movementIdentity(e) === movementId && completed(e).length,
        );
        return e
          ? [
              {
                session: s,
                exercise: e,
                value:
                  metric === "weight"
                    ? Math.max(...completed(e).map((x) => x.weight))
                    : volume(e),
              },
            ]
          : [];
      })
      .slice(-12);
  const max = Math.max(1, ...points.map((p) => p.value)),
    best = points.length
      ? Math.max(
          ...history.flatMap((s) =>
            s.exercises
              .filter((e) => movementIdentity(e) === movementId)
              .flatMap((e) => completed(e).map((t) => t.weight)),
          ),
        )
      : 0;
  return (
    <>
      <PageTitle title="每一组，都算数" />
      <div className="history-overview">
        <div className="segmented compact">
          {[7, 30].map((n) => (
            <button
              key={n}
              className={days === n ? "active" : ""}
              aria-pressed={days === n}
              onClick={() => setDays(n)}
            >
              最近 {n} 天
            </button>
          ))}
        </div>
        <div className="period-stats">
          <p>
            <strong>{recent.length}</strong> 次训练
          </p>
          <p>
            <strong>{recent.reduce((n, s) => n + stats(s).sets, 0)}</strong>{" "}
            工作组
          </p>
        </div>
        <p className="helper">按训练开始时间统计，仅包含已结束的真实训练。</p>
      </div>
      <section className="trend-section">
        <div className="section-heading">
          <h2>看得见的积累</h2>
          <BarChart3 size={21} />
        </div>
        {names.length ? (
          <>
            <label className="chart-select">
              <span className="sr-only">趋势动作</span>
              <select
                aria-label="趋势动作"
                value={movementId}
                onChange={(e) => setMovement(e.target.value)}
              >
                {names.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div className="chart-meta">
              <div>
                <strong>{fmt(best)}</strong>
                <span>kg · 已记录最大工作组重量</span>
              </div>
              <select
                aria-label="趋势指标"
                value={metric}
                onChange={(e) => setMetric(e.target.value as typeof metric)}
              >
                <option value="weight">重量 kg</option>
                <option value="volume">训练量 kg·次</option>
              </select>
            </div>
            <p className="helper">
              {points[0]?.exercise.basis}口径 · 同动作版本 · 最近{" "}
              {points.length} 次记录
              {points.length === 1 ? "，更多记录后形成趋势。" : ""}
            </p>
            <div
              className="chart"
              role="img"
              aria-label={`${names.find((n) => n[0] === movementId)?.[1]}${metric === "weight" ? "重量" : "训练量"}趋势`}
            >
              <svg viewBox="0 0 600 220">
                <g className="grid-lines">
                  {[25, 80, 135, 190].map((y, i) => (
                    <g key={y}>
                      <line x1="48" x2="580" y1={y} y2={y} />
                      <text x="38" y={y + 4} textAnchor="end">
                        {fmt((max * (3 - i)) / 3)}
                      </text>
                    </g>
                  ))}
                </g>
                <polyline
                  points={points
                    .map(
                      (p, i) =>
                        `${points.length === 1 ? 310 : 60 + i * (510 / (points.length - 1))},${190 - (p.value / max) * 165}`,
                    )
                    .join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                {points.map((p, i) => {
                  const x =
                      points.length === 1
                        ? 310
                        : 60 + (i * 510) / (points.length - 1),
                    y = 190 - (p.value / max) * 165;
                  return (
                    <g key={p.session.id}>
                      <circle cx={x} cy={y} r="5" />
                      <text x={x} y={Math.max(14, y - 13)} textAnchor="middle">
                        {fmt(p.value)}
                      </text>
                      {(points.length <= 6 ||
                        i === 0 ||
                        i === points.length - 1) && (
                        <text
                          className="axis-date"
                          x={x}
                          y="215"
                          textAnchor="middle"
                        >
                          {date(p.session.startedAt)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
            <details className="trend-data">
              <summary>
                查看趋势数据
                <ChevronDown size={15} />
              </summary>
              {points.map((p) => (
                <div className="data-line" key={p.session.id}>
                  <span>{date(p.session.startedAt)}</span>
                  <b>
                    {fmt(p.value)} {metric === "weight" ? "kg" : "kg·次"}
                  </b>
                </div>
              ))}
            </details>
          </>
        ) : (
          <div className="empty">
            <p>完成第一节训练后，这里会显示真实趋势。</p>
          </div>
        )}
      </section>
      <section>
        <div className="section-heading">
          <h2>训练时间线</h2>
          <span>{history.length} 次</span>
        </div>
        <label className="date-filter">
          按日期查找
          <input
            aria-label="按日期查找"
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
          />
          {filterDate && (
            <button className="text-button" onClick={() => setFilterDate("")}>
              清除
            </button>
          )}
        </label>
        {history
          .filter((s) => !filterDate || localDate(s.startedAt) === filterDate)
          .reverse()
          .map((s) => (
            <HistoryRow key={s.id} s={s} onClick={() => onSelect(s)} />
          ))}
        {(!history.length ||
          (history.every((s) => localDate(s.startedAt) !== filterDate) &&
            filterDate)) && <p className="empty">此日期暂无训练记录。</p>}
      </section>
    </>
  );
}
function localDate(s: string) {
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function Summary({
  profile,
  session,
  sessions,
  back,
}: {
  session: Session;
  sessions: Session[];
  profile: Profile | null;
  back: () => void;
}) {
  const info = stats(session),
    actuals = session.exercises.filter((e) => completed(e).length);
  return (
    <>
      <PageTitle title="训练已保存" back={back} />
      <FeedbackCard session={session} sessions={sessions} profile={profile} />
      <section className="summary-hero">
        <Check size={28} />
        <p>{date(session.startedAt, true)}</p>
        <h2>
          {session.theme}
          <span>训练完成。</span>
        </h2>
        <div className="summary-stats">
          <div>
            <strong>{info.exercises}</strong>
            <span>实际动作</span>
          </div>
          <div>
            <strong>{info.sets}</strong>
            <span>工作组</span>
          </div>
          <div>
            <strong>
              {session.source === "markdown" ? "—" : info.minutes}
            </strong>
            <span>分钟</span>
          </div>
        </div>
      </section>
      <section className="actual-records">
        <h2>实际训练记录</h2>
        {actuals.map((e) => {
          const previous = sessions
            .filter(
              (s) =>
                s.id !== session.id &&
                s.status === "finished" &&
                Date.parse(s.startedAt) < Date.parse(session.startedAt),
            )
            .flatMap((s) =>
              s.exercises
                .filter((x) => sameMovement(x, e))
                .flatMap((x) => completed(x).map((t) => t.weight)),
            );
          const max = Math.max(...completed(e).map((t) => t.weight));
          return (
            <article key={e.id}>
              <div className="section-heading">
                <h3>{e.name}</h3>
                {e.basis !== "自重" &&
                  previous.length > 0 &&
                  max > Math.max(...previous) && (
                    <span className="pb">已记录重量最佳</span>
                  )}
              </div>
              <p className="helper">
                {e.basis} ·{" "}
                {e.restRecorded === false
                  ? "休息未记录"
                  : `休息 ${restLabel(e.rest)}`}
              </p>
              {completed(e).map((s, i) => (
                <div className="actual-set" key={i}>
                  <span>第 {i + 1} 组</span>
                  <strong>
                    {e.basis === "自重" ? "自重" : `${fmt(s.weight)} kg`} ×{" "}
                    {s.reps}
                  </strong>
                  <span>
                    {s.feeling ?? "—"}
                    {s.rpe !== undefined ? ` · RPE ${s.rpe}` : ""}
                  </span>
                </div>
              ))}
              {e.reportedRpe && (
                <p className="volume-label">
                  {e.reportedRpe.scope === "top-set" ? "顶组" : "动作整体"} RPE{" "}
                  {e.reportedRpe.value}（原日志记录，未分摊至各组）
                </p>
              )}
              <p className="volume-label">
                {e.basis === "自重"
                  ? "自重工作量不估算 kg"
                  : `计重工作量 ${fmt(volume(e))} kg·次`}
                {e.basis === "单只哑铃"
                  ? "（单只口径）"
                  : e.basis === "自重"
                    ? "（自重不估算体重）"
                    : ""}
              </p>
            </article>
          );
        })}
      </section>
      {session.coachReference && (
        <details className="usage-guide">
          <summary>
            原日志教练观察（仅供参考）
            <ChevronDown size={16} />
          </summary>
          <p className="preserved-reference">{session.coachReference}</p>
        </details>
      )}
      <label className="session-note">
        训练后备注<p>{session.note || "本次未记录额外感受。"}</p>
      </label>
      <Button kind="secondary" onClick={back}>
        查看训练历史
        <ArrowRight size={18} />
      </Button>
    </>
  );
}
function DataTools({
  state,
  save,
  busy,
  notify,
}: {
  state: State;
  save: (fn: (s: State) => State) => Promise<boolean>;
  busy: boolean;
  notify: (s: string) => void;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null),
    [error, setError] = useState(""),
    [ack, setAck] = useState(false);
  async function selectFile(file?: File) {
    if (!file) return;
    setError("");
    setAck(false);
    setPreview(null);
    try {
      if (file.size > 20 * 1024 * 1024)
        throw Error("文件超过 20 MB，请分批导入");
      setPreview(parseImport(await file.text(), file.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : "文件无法读取");
    }
  }
  function download() {
    const blob = new Blob([backup(state)], { type: "application/json" }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `traintrace-backup-${localDate(new Date().toISOString())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    notify("已生成 JSON 备份。请确认浏览器下载完成，并妥善保存文件。");
  }
  return (
    <section className="data-tools">
      <h2>把积累，留在手里。</h2>
      <p>
        JSON 完整备份包含偏好、历史和未完成训练。导入时合并记录，相同 ID
        不重复计入；冲突内容会拒绝覆盖。
      </p>
      <div className="button-row">
        <Button kind="secondary" disabled={busy} onClick={download}>
          <ArrowDownToLine size={18} />
          导出完整备份
        </Button>
        <label className="button secondary upload-label">
          <Upload size={18} />
          导入数据
          <input
            aria-label="导入数据文件"
            type="file"
            accept=".json,.md,.txt,application/json,text/markdown,text/plain"
            disabled={busy}
            onChange={(e) => {
              void selectFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {error && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="import-preview">
          <div className="section-heading">
            <h3>确认导入内容</h3>
            <button
              className="icon-button"
              aria-label="取消导入"
              onClick={() => setPreview(null)}
            >
              <X size={18} />
            </button>
          </div>
          <p className="file-name">{preview.label}</p>
          <p>
            {preview.state.sessions.length} 节训练 ·{" "}
            {preview.state.sessions.reduce((n, s) => n + stats(s).sets, 0)}{" "}
            个已完成工作组{preview.state.profile ? " · 含训练档案" : ""}
          </p>
          {preview.state.sessions.slice(0, 10).map((s) => (
            <div className="import-row" key={s.id}>
              {date(s.startedAt)} · {s.theme} ·{" "}
              {s.exercises
                .map((e) => `${e.name} ${completed(e).length}组`)
                .join("、")}
            </div>
          ))}
          {preview.warnings.length > 0 && (
            <>
              <p className="warning">部分内容未导入，请核对：</p>
              <ul>
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                我已核对未导入内容，只导入预览中的记录
              </label>
            </>
          )}
          {preview.state.sessions.some((s) => s.source === "markdown") && (
            <p className="helper">
              Markdown
              未记录精确时长，导入后时长显示为「—」。导入后以本地数据库为网页唯一事实源，原
              Markdown 仅作离线归档。
            </p>
          )}
          <Button
            disabled={busy || (preview.warnings.length > 0 && !ack)}
            onClick={async () => {
              if (await save((s) => mergeState(s, preview.state))) {
                notify("导入完成。重复记录已去重；已有训练档案保留。");
                setPreview(null);
              }
            }}
          >
            确认合并导入
            <Check size={18} />
          </Button>
        </div>
      )}
      <details>
        <summary>
          从原 Skill 的 Markdown 迁移
          <ChevronDown size={15} />
        </summary>
        <p>
          选择
          fitness-coach-data/training_log.md。只解析「实际完成」章节中的明确工作组，忽略计划、教练观察与待确认数据。目标、经验、器械可在上方确认；状态摘要不作为事实导入。
        </p>
        <pre>
          {
            "## 2026-10-01｜胸部\n\n### 实际完成\n- 杠铃卧推：60 kg × 8 / 8 / 7\n- 上斜哑铃卧推：20 kg × 10 / 10（单只）"
          }
        </pre>
        <p>
          支持同重量逐组次数或「60 kg × 8 × 3
          组」。未知动作、缺失单位与模糊描述会提示，V1
          不自动猜测。导入预览核对后再确认。
        </p>
      </details>
    </section>
  );
}
