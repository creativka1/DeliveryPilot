"use client";
import {
  useState,
  useEffect,
  useCallback,
  useId,
  cloneElement,
  type FormEvent,
  type ReactNode,
  type ReactElement,
} from "react";
import {
  LayoutDashboard,
  Package,
  Video,
  ClipboardCheck,
  Users,
  History,
  Settings,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  Bell,
  Sun,
  Moon,
  ChevronRight,
  MapPin,
  Clock,
  Check,
  CheckCheck,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Radio,
  Camera,
  Activity,
  X,
  Menu,
  Loader2,
  Box,
  ExternalLink,
  Play,
  ScanLine,
  ShieldCheck,
  Send,
  RefreshCw,
  Pencil,
  Trash2,
  Unplug,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  cn,
  initials,
  statusLabel,
  time,
  dateLabel,
  localDateTime,
  zonedISO,
  duration,
} from "@/lib/utils";
import type { AppState } from "@/lib/state";
import { RingViewer } from "./ring-viewer";

type Section =
  | "Overview"
  | "Deliveries"
  | "Ring Live"
  | "Receiving Tasks"
  | "Employees"
  | "Activity History"
  | "Settings";
type Delivery = AppState["deliveries"][number];
type Employee = AppState["employees"][number];
type Task = AppState["tasks"][number];
type Arrival = AppState["events"][number];
type Modal =
  | { type: "delivery"; delivery?: Delivery }
  | { type: "employee"; employee?: Employee }
  | { type: "test" }
  | { type: "arrival"; event: Arrival }
  | { type: "detail"; delivery: Delivery }
  | { type: "issue"; task: Task; action: "exception" | "escalate" | "resolve" }
  | { type: "reassign"; task: Task }
  | { type: "archive"; delivery: Delivery };
const nav = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Deliveries", icon: Package },
  { name: "Ring Live", icon: Video },
  { name: "Receiving Tasks", icon: ClipboardCheck },
  { name: "Employees", icon: Users },
  { name: "Activity History", icon: History },
  { name: "Settings", icon: Settings },
] as const;
const sectionText: Record<Section, string> = {
  Overview: "A clear view of every arrival and every handoff.",
  Deliveries: "Plan the arrival. Keep the whole team in the loop.",
  "Ring Live": "See the entrance. Keep evidence and inference separate.",
  "Receiving Tasks": "From arrival to receipt, with a person accountable.",
  Employees: "The right people, at the right receiving entrance.",
  "Activity History": "Every action, its source, and the person behind it.",
  Settings: "Make DeliveryPilot work the way your business receives.",
};
async function api<T = unknown>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const r = await fetch("/api/" + path, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
    cache: "no-store",
  });
  const p = await r.json();
  if (!r.ok) throw new Error(p.error ?? "The request failed.");
  return p;
}
function Badge({ status }: { status: string }) {
  return (
    <span className={cn("badge", "status-" + status.toLowerCase())}>
      <span className="status-dot" />
      {statusLabel(status)}
    </span>
  );
}
function Source({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "source",
        value === "LOCAL_TEST" ||
          value === "DEMO_SEED" ||
          value === "SIMULATED_RING_WEBHOOK"
          ? "source-test"
          : value.startsWith("RING")
            ? "source-ring"
            : "source-human",
      )}
    >
      {value === "SIMULATED_RING_WEBHOOK"
        ? "Simulated webhook"
        : value === "LOCAL_TEST"
          ? "Local test"
          : value === "DEMO_SEED"
            ? "Demo setup"
            : value === "RING_WEBHOOK"
              ? "Signed Ring webhook"
              : value === "RING_API"
                ? "Real Ring API"
                : "Employee action"}
    </span>
  );
}
function Empty({
  icon: Icon = Package,
  title,
  children,
  action,
}: {
  icon?: typeof Package;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={23} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(
        children as ReactElement<{ id?: string; "aria-describedby"?: string }>,
        { id, "aria-describedby": hint ? id + "-hint" : undefined },
      )}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}
function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={cn("avatar", small && "avatar-sm")}>{initials(name)}</span>
  );
}
function effectiveStatus(d: Delivery, now: string) {
  return new Date(d.windowEnd) < new Date(now) &&
    ["EXPECTED", "DELAYED", "POSSIBLE_ARRIVAL"].includes(d.status)
    ? "DELAYED"
    : d.status;
}

export function Workspace() {
  const [state, setState] = useState<AppState | null>(null),
    [section, setSection] = useState<Section>("Overview"),
    [modal, setModal] = useState<Modal | null>(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [pending, setPending] = useState(false),
    [live, setLive] = useState(false),
    [dark, setDark] = useState(false),
    [mobile, setMobile] = useState(false),
    [showNotifications, setShowNotifications] = useState(false),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("ALL"),
    [login, setLogin] = useState(false),
    [password, setPassword] = useState("");
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      const p = await r.json();
      if (r.status === 401) {
        setLogin(true);
        return;
      }
      if (!r.ok) throw new Error(p.error);
      setLogin(false);
      setState(p);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load the workspace.",
      );
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void refresh());
    const events = new EventSource("/api/stream");
    events.addEventListener("ready", () => setLive(true));
    events.addEventListener("change", () => {
      setLive(true);
      void refresh();
    });
    events.onerror = () => setLive(false);
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      events.close();
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    const enabled = localStorage.getItem("dp-theme") === "dark";
    queueMicrotask(() => setDark(enabled));
    document.documentElement.classList.toggle("dark", enabled);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const navigate = (next: Section) => {
    setSection(next);
    setQuery("");
    setFilter("ALL");
    setMobile(false);
    setShowNotifications(false);
  };
  const mutate = async (
    path: string,
    method: string,
    data?: unknown,
    message?: string,
    close = true,
  ) => {
    setPending(true);
    setError("");
    try {
      const result = await api(path, method, data);
      await refresh();
      if (close) setModal(null);
      if (message) setToast(message);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action failed.");
      throw e;
    } finally {
      setPending(false);
    }
  };
  const safe = (f: () => Promise<unknown>) => {
    void f().catch(() => {});
  };
  const changeTheme = () => {
    setDark(!dark);
    localStorage.setItem("dp-theme", !dark ? "dark" : "light");
    document.documentElement.classList.toggle("dark", !dark);
  };
  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    safe(() => mutate("session", "POST", { password }, "Signed in."));
  };
  if (login)
    return (
      <main className="login-screen">
        <div className="login-card">
          <Brand />
          <h1>Welcome back.</h1>
          <p>Enter the workspace password to open DeliveryPilot.</p>
          <form onSubmit={handleLogin}>
            <Field label="Workspace password">
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button disabled={pending}>
              Open workspace <ArrowRight size={16} />
            </Button>
          </form>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
      </main>
    );
  if (!state)
    return (
      <main className="loading-screen">
        <Brand />
        <Loader2 className="spin" size={24} />
        <p>{error || "Opening your receiving workspace…"}</p>
        {error && <Button onClick={() => void refresh()}>Try again</Button>}
      </main>
    );
  const s = state,
    tz = s.business.timezone,
    isManager = s.actor.role === "MANAGER";
  const unread = s.notifications.filter((n) => !n.readAt).length;
  const tasks = s.tasks.filter((t) => !["RECEIVED"].includes(t.status));
  const suggestions = s.events.filter((e) => e.matchStatus === "SUGGESTED");
  const todayDeliveries = s.deliveries.filter(
    (d) => dateKey(d.windowStart, tz) === s.today,
  );
  const deliveries = s.deliveries.filter(
    (d) =>
      (
        d.supplier +
        " " +
        d.reference +
        " " +
        d.location.name +
        " " +
        (d.employee?.name ?? "")
      )
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "ALL" || effectiveStatus(d, s.serverTime) === filter),
  );
  const act = (t: Task, action: string) =>
    safe(() =>
      mutate(
        `tasks/${t.id}`,
        "POST",
        { action },
        action === "complete"
          ? "Receipt confirmed and recorded."
          : action === "start"
            ? "Receiving started."
            : "Task acknowledged.",
        false,
      ),
    );
  const openArrival = (e: Arrival) => setModal({ type: "arrival", event: e });
  const renderDeliveries = (items: Delivery[], compact = false) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Supplier / order</th>
            <th>Expected window</th>
            <th>Entrance</th>
            <th>Assigned to</th>
            <th>Status</th>
            {!compact && isManager && (
              <th>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id}>
              <td>
                <button
                  className="supplier-cell"
                  onClick={() => setModal({ type: "detail", delivery: d })}
                >
                  <span
                    className={cn(
                      "supplier-icon",
                      d.id === "eastpoint"
                        ? "violet"
                        : d.id === "meridian"
                          ? "sand"
                          : "",
                    )}
                  >
                    <Box size={19} />
                  </span>
                  <span>
                    <strong>{d.supplier}</strong>
                    <small>{d.reference}</small>
                  </span>
                </button>
              </td>
              <td>
                <span className="table-time">
                  {time(d.windowStart, tz)} – {time(d.windowEnd, tz)}
                </span>
                <small>{dateLabel(d.windowStart, tz)}</small>
              </td>
              <td>
                <span className="inline">
                  <MapPin size={13} />
                  {d.location.name}
                </span>
              </td>
              <td>
                {d.employee ? (
                  <span className="inline">
                    <Avatar name={d.employee.name} small />
                    {d.employee.name}
                  </span>
                ) : (
                  <span className="muted">Unassigned</span>
                )}
              </td>
              <td>
                <Badge status={effectiveStatus(d, s.serverTime)} />
              </td>
              {!compact && isManager && (
                <td>
                  <div className="row-actions">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${d.supplier}`}
                      onClick={() =>
                        setModal({ type: "delivery", delivery: d })
                      }
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${d.supplier}`}
                      onClick={() => setModal({ type: "archive", delivery: d })}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && (
        <Empty title="No deliveries found">
          Try another search or add an expected delivery.
        </Empty>
      )}
    </div>
  );
  const taskCard = (t: Task) => (
    <article className="task-card" key={t.id}>
      <div className="flex-between">
        <span className="overline">{t.delivery.reference}</span>
        <Badge status={t.status} />
      </div>
      <h3>{t.delivery.supplier}</h3>
      <p className="inline">
        <MapPin size={14} />
        {t.delivery.location.name}
        <span className="dot-separator">·</span>
        {time(t.delivery.windowStart, tz)} – {time(t.delivery.windowEnd, tz)}
      </p>
      <div className="task-assignee">
        <Avatar name={t.employee?.name ?? "?"} />
        <div>
          <strong>{t.employee?.name ?? "Needs assignment"}</strong>
          <small>
            {t.employee
              ? "Assigned receiver"
              : "Designated employee unavailable"}
          </small>
        </div>
        {isManager && t.status !== "RECEIVED" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setModal({ type: "reassign", task: t })}
          >
            Reassign
          </Button>
        )}
      </div>
      {t.issue && (
        <div className="issue-note">
          <AlertTriangle size={15} />
          {t.issue}
        </div>
      )}
      <div className="task-progress">
        {["Acknowledge", "Receive", "Confirm"].map((x, i) => {
          const step =
            t.status === "RECEIVED"
              ? 3
              : t.status === "RECEIVING"
                ? 2
                : t.acknowledgedAt
                  ? 1
                  : 0;
          return (
            <span key={x} className={step > i ? "done" : ""}>
              <i>{step > i ? <Check size={11} /> : i + 1}</i>
              {x}
            </span>
          );
        })}
      </div>
      <div className="task-footer">
        <small>
          Assigned {dateLabel(t.assignedAt, tz)}, {time(t.assignedAt, tz)}
        </small>
        {t.status === "PENDING" &&
          new Date(s.serverTime).getTime() - new Date(t.assignedAt).getTime() >
            s.business.acknowledgmentMinutes * 60000 && (
            <span className="overdue">Acknowledgment overdue</span>
          )}
      </div>
      {(isManager || t.employeeId === s.actor.id) && (
        <div className="task-buttons">
          {t.status === "PENDING" && (
            <Button
              disabled={pending || !t.employeeId}
              onClick={() => act(t, "acknowledge")}
            >
              <Check size={15} />
              Acknowledge
            </Button>
          )}
          {t.status === "ACKNOWLEDGED" && (
            <>
              <Button disabled={pending} onClick={() => act(t, "start")}>
                <Play size={14} />
                Start receiving
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => act(t, "complete")}
              >
                Confirm received
              </Button>
            </>
          )}
          {t.status === "RECEIVING" && (
            <Button disabled={pending} onClick={() => act(t, "complete")}>
              <CheckCheck size={16} />
              Confirm received
            </Button>
          )}
          {["EXCEPTION", "ESCALATED"].includes(t.status) && isManager && (
            <Button
              onClick={() =>
                setModal({ type: "issue", task: t, action: "resolve" })
              }
            >
              Resolve issue
            </Button>
          )}
          {["PENDING", "ACKNOWLEDGED", "RECEIVING"].includes(t.status) && (
            <div className="task-secondary">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setModal({ type: "issue", task: t, action: "exception" })
                }
              >
                Report problem
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setModal({ type: "issue", task: t, action: "escalate" })
                }
              >
                Escalate <ArrowUpRight size={12} />
              </Button>
            </div>
          )}
        </div>
      )}
      {t.status === "RECEIVED" && (
        <div className="receipt">
          <ShieldCheck size={15} />
          Human confirmed · {time(t.completedAt!, tz)}
        </div>
      )}
    </article>
  );
  return (
    <div className="workspace">
      <aside className={cn("sidebar", mobile && "sidebar-open")}>
        <Brand />
        <div className="workspace-switch">
          <span className="workspace-avatar">N</span>
          <div>
            <strong>Northstar</strong>
            <small>Retail warehouse</small>
          </div>
          <span className="workspace-plan">WORKSPACE</span>
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              aria-label={name}
              className={cn("nav-item", section === name && "active")}
              onClick={() => navigate(name)}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === "Receiving Tasks" && tasks.length > 0 && (
                <b>{tasks.length}</b>
              )}
              {name === "Ring Live" && (
                <span
                  className={cn("nav-dot", s.checks[0]?.success && "connected")}
                />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="integration-mini">
            <span className="ring-mark">ring</span>
            <div>
              <strong>
                {s.checks[0]?.success
                  ? "API verified"
                  : "Connect your entrance"}
              </strong>
              <small>
                {s.checks[0]?.success ? "Ring Partner API" : "Ring integration"}
              </small>
            </div>
            <button
              aria-label="Open Ring integration settings"
              onClick={() => navigate("Settings")}
            >
              <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="identity">
            <Avatar name={s.actor.name} />
            <div>
              <strong>{s.actor.name}</strong>
              <small>
                {s.actor.role === "MANAGER"
                  ? "Workspace manager"
                  : "Receiving employee"}
              </small>
            </div>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="Close menu"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{section}</strong>
          </div>
          <div className="topbar-actions">
            <span className="live-state">
              <span className={live ? "online-dot" : "offline-dot"} />
              {live ? "Live updates" : "Reconnecting"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? "Use light mode" : "Use dark mode"}
              onClick={changeTheme}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </Button>
            <div className="notification-anchor">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
                onClick={() => {
                  setShowNotifications(!showNotifications);
                  if (!showNotifications && unread)
                    safe(() =>
                      mutate(
                        "notifications/read",
                        "POST",
                        {},
                        undefined,
                        false,
                      ),
                    );
                }}
              >
                <Bell size={18} />
                {unread > 0 && <i className="notification-count">{unread}</i>}
              </Button>
              {showNotifications && (
                <div className="notification-panel">
                  <div className="panel-heading">
                    <strong>Notifications</strong>
                    <button
                      aria-label="Close notifications"
                      onClick={() => setShowNotifications(false)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {s.notifications.length ? (
                    s.notifications.map((n) => (
                      <button
                        key={n.id}
                        onClick={() =>
                          navigate(n.taskId ? "Receiving Tasks" : "Ring Live")
                        }
                      >
                        <span className="notification-icon">
                          <ClipboardCheck size={16} />
                        </span>
                        <span>
                          <strong>{n.message}</strong>
                          <small>
                            {dateLabel(n.createdAt, tz)} ·{" "}
                            {time(n.createdAt, tz)}
                          </small>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))
                  ) : (
                    <p className="notification-empty">You’re all caught up.</p>
                  )}
                </div>
              )}
            </div>
            <span className="topbar-divider" />
            <Avatar name={s.actor.name} small />
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                RECEIVING OPERATIONS <span>/</span>{" "}
                {s.demoMode ? "LOCAL DEMO" : "PRIVATE WORKSPACE"}
              </div>
              <h1>
                {section === "Overview"
                  ? "Every delivery. A clear handoff."
                  : section}
              </h1>
              <p>{sectionText[section]}</p>
            </div>
            <div className="heading-actions">
              {s.demoMode && (
                <label className="acting-as">
                  <span>Acting as</span>
                  <select
                    aria-label="Acting as employee"
                    value={s.actor.id}
                    onChange={(e) =>
                      safe(() =>
                        mutate(
                          "session",
                          "POST",
                          { employeeId: e.target.value },
                          "Employee view changed.",
                          false,
                        ),
                      )
                    }
                  >
                    {s.employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {isManager &&
                (section === "Overview" || section === "Deliveries") && (
                  <Button onClick={() => setModal({ type: "delivery" })}>
                    <Plus size={16} />
                    New delivery
                  </Button>
                )}
              {isManager && section === "Employees" && (
                <Button onClick={() => setModal({ type: "employee" })}>
                  <Plus size={16} />
                  Add employee
                </Button>
              )}
            </div>
          </div>
          {error && (
            <div role="alert" className="error-banner">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {section === "Overview" && (
            <>
              <div className="overview-date">
                <span className="inline">
                  <Clock size={14} />
                  {new Intl.DateTimeFormat("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    timeZone: tz,
                  }).format(new Date(s.serverTime))}
                </span>
                <span>
                  {tz} <span className="dot-separator">·</span>{" "}
                  {time(s.serverTime, tz)}
                </span>
              </div>
              <div className="metrics-grid">
                {[
                  {
                    label: "Expected today",
                    value: s.metrics.expected,
                    icon: Package,
                    sub: "Deliveries on the schedule",
                    target: "Deliveries",
                    tone: "",
                  },
                  {
                    label: "Confirmed receipts",
                    value: s.metrics.confirmed,
                    icon: CheckCircle2,
                    sub: "Confirmed by an employee",
                    target: "Deliveries",
                    tone: "mint",
                  },
                  {
                    label: "Awaiting acknowledgment",
                    value: s.metrics.unacknowledged,
                    icon: ClipboardCheck,
                    sub: "Tasks needing a response",
                    target: "Receiving Tasks",
                    tone: "blue",
                  },
                  {
                    label: "Late deliveries",
                    value: s.metrics.late,
                    icon: Clock,
                    sub: "Past their expected window",
                    target: "Deliveries",
                    tone: "amber",
                  },
                ].map((m) => (
                  <button
                    className="metric-card"
                    key={m.label}
                    onClick={() => {
                      navigate(m.target as Section);
                      if (m.label === "Late deliveries") setFilter("DELAYED");
                      if (m.label === "Confirmed receipts")
                        setFilter("RECEIVED");
                    }}
                  >
                    <div className="flex-between">
                      <span>{m.label}</span>
                      <i className={m.tone}>
                        <m.icon size={17} />
                      </i>
                    </div>
                    <strong>{m.value.toString().padStart(2, "0")}</strong>
                    <small>{m.sub}</small>
                  </button>
                ))}
              </div>
              <div className="overview-grid">
                <div className="primary-column">
                  <section className="panel schedule-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          Today’s delivery schedule{" "}
                          <span className="count-pill">
                            {todayDeliveries.length}
                          </span>
                        </h2>
                        <p>
                          Expected arrivals across your receiving entrances.
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate("Deliveries")}
                      >
                        View all <ArrowUpRight size={14} />
                      </Button>
                    </div>
                    {renderDeliveries(todayDeliveries, true)}
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>From activity to accountability</h2>
                        <p>
                          A signal starts the process. A person confirms the
                          receipt.
                        </p>
                      </div>
                      <span className="tiny-badge">YOUR WORKFLOW</span>
                    </div>
                    <div className="pipeline">
                      {[
                        {
                          name: "Activity",
                          count: s.metrics.activityCount,
                          icon: Radio,
                          description: "Entrance signal",
                        },
                        {
                          name: "Match",
                          count: s.metrics.suggestionCount,
                          icon: ScanLine,
                          description: "Schedule suggestion",
                        },
                        {
                          name: "Receive",
                          count: tasks.length,
                          icon: ClipboardCheck,
                          description: "Employee handoff",
                        },
                        {
                          name: "Confirmed",
                          count: s.deliveries.filter(
                            (d) => d.status === "RECEIVED",
                          ).length,
                          icon: CheckCheck,
                          description: "Human verification",
                        },
                      ].map((p, i) => (
                        <div key={p.name} className="pipeline-step">
                          <span
                            className={
                              i === 3 ? "pipeline-icon final" : "pipeline-icon"
                            }
                          >
                            <p.icon size={20} />
                          </span>
                          <strong>
                            {p.name}
                            <b>{p.count}</b>
                          </strong>
                          <small>{p.description}</small>
                          {i < 3 && (
                            <ChevronRight
                              className="pipeline-arrow"
                              size={16}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="pipeline-note">
                      <ShieldCheck size={15} />
                      Camera activity alone never marks a delivery as received.
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Activity timeline</h2>
                        <p>The latest steps, with their evidence source.</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate("Activity History")}
                      >
                        Full history <ArrowUpRight size={14} />
                      </Button>
                    </div>
                    <AuditTimeline entries={s.audit.slice(0, 6)} tz={tz} />
                  </section>
                </div>
                <div className="secondary-column">
                  <section className="entrance-card">
                    <div className="entrance-top">
                      <span className="inline">
                        <Camera size={15} />
                        YOUR RECEIVING ENTRANCE
                      </span>
                      <span className="ring-wordmark">ring</span>
                    </div>
                    <div className="entrance-visual">
                      <div className="camera-orbit">
                        <Camera size={35} strokeWidth={1.25} />
                        <span />
                      </div>
                      <h2>
                        {s.checks[0]?.success
                          ? "Your entrance is connected."
                          : "Your entrance, connected."}
                      </h2>
                      <p>
                        {s.checks[0]?.success
                          ? "Open a discovered camera to start a real WHEP video stream."
                          : "Connect Ring to bring entrance activity into your receiving workflow."}
                      </p>
                      <Button
                        onClick={() => navigate("Ring Live")}
                        variant="outline"
                      >
                        Open Ring Live <ArrowUpRight size={14} />
                      </Button>
                    </div>
                    <div className="entrance-foot">
                      <span
                        className={
                          s.checks[0]?.success ? "online-dot" : "neutral-dot"
                        }
                      />
                      {s.checks[0]?.success
                        ? "Real API connection verified"
                        : "Ring connection not verified"}
                    </div>
                  </section>
                  <section className="panel compact-panel">
                    <div className="panel-heading">
                      <h2>Operations pulse</h2>
                      <Activity size={17} />
                    </div>
                    <div className="pulse-row">
                      <span>
                        <Radio size={15} />
                        Potential arrivals
                      </span>
                      <strong>{s.metrics.potential}</strong>
                    </div>
                    <div className="pulse-row">
                      <span>
                        <AlertCircle size={15} />
                        Open exceptions
                      </span>
                      <strong>{s.metrics.exceptions}</strong>
                    </div>
                    <div className="pulse-row">
                      <span>
                        <Clock size={15} />
                        Avg. acknowledgment
                      </span>
                      <strong>
                        {duration(s.metrics.avgAcknowledgmentSeconds)}
                      </strong>
                    </div>
                    <div className="pulse-row">
                      <span>
                        <CheckCheck size={15} />
                        Avg. receiving time
                      </span>
                      <strong>{duration(s.metrics.avgReceivingSeconds)}</strong>
                    </div>
                    <p className="panel-footnote">
                      Timing averages use tasks assigned today and actual
                      employee timestamps.
                    </p>
                  </section>
                  {s.demoMode && isManager && (
                    <section className="demo-callout">
                      <span className="demo-label">
                        <span />
                        LOCAL TESTING
                      </span>
                      <h3>Try the complete handoff.</h3>
                      <p>
                        Generate a clearly labeled test arrival, review its
                        matches, then receive it as Alex.
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => setModal({ type: "test" })}
                      >
                        Create test activity <ArrowRight size={14} />
                      </Button>
                    </section>
                  )}
                </div>
              </div>
              {(suggestions.length > 0 || tasks.length > 0) && (
                <section className="attention-strip">
                  <div>
                    <span className="attention-icon">
                      <Bell size={18} />
                    </span>
                    <span>
                      <strong>
                        {suggestions.length} arrivals to review · {tasks.length}{" "}
                        open tasks
                      </strong>
                      <small>Move the next handoff forward.</small>
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      navigate(
                        suggestions.length ? "Ring Live" : "Receiving Tasks",
                      )
                    }
                  >
                    Take a look <ArrowRight size={15} />
                  </Button>
                </section>
              )}
            </>
          )}
          {section === "Deliveries" && (
            <section className="panel">
              <div className="table-toolbar">
                <label className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Search deliveries"
                    placeholder="Search supplier, reference, employee…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      aria-label="Clear delivery search"
                      onClick={() => setQuery("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </label>
                <div className="inline">
                  <SlidersHorizontal size={15} />
                  <select
                    aria-label="Filter delivery status"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="ALL">All statuses</option>
                    {[
                      "EXPECTED",
                      "POSSIBLE_ARRIVAL",
                      "AWAITING_ACKNOWLEDGMENT",
                      "RECEIVING",
                      "RECEIVED",
                      "DELAYED",
                      "EXCEPTION",
                    ].map((st) => (
                      <option key={st} value={st}>
                        {statusLabel(st)}
                      </option>
                    ))}
                  </select>
                  <span className="count-pill">
                    {deliveries.length} deliveries
                  </span>
                </div>
              </div>
              {renderDeliveries(deliveries)}
              <div className="table-bottom">
                <ShieldCheck size={14} />
                Receipt status changes only through the receiving workflow.
              </div>
            </section>
          )}
          {section === "Ring Live" && (
            <>
              <div className="ring-layout">
                <section className="panel ring-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Ring live view</h2>
                      <p>Documented WHEP / WebRTC streaming.</p>
                    </div>
                    <span className="ring-mark">ring</span>
                  </div>
                  <RingViewer
                    cameras={s.cameras.filter((c) => c.source === "RING_API")}
                    configured={s.integration.configured}
                    canConnect={isManager}
                    onConnect={() =>
                      mutate(
                        "ring/connect",
                        "POST",
                        {},
                        "Device discovery completed.",
                        false,
                      )
                    }
                    onError={setError}
                  />
                </section>
                <section className="panel evidence-panel">
                  <div className="panel-heading">
                    <h2>Evidence, clearly labeled</h2>
                    <ShieldCheck size={18} />
                  </div>
                  <div className="evidence-level">
                    <span className="evidence-number">01</span>
                    <div>
                      <strong>Camera evidence</strong>
                      <p>
                        A signed Ring event proves that activity was reported.
                      </p>
                    </div>
                  </div>
                  <div className="evidence-level">
                    <span className="evidence-number">02</span>
                    <div>
                      <strong>Suggested match</strong>
                      <p>
                        Entrance and time correlate with an expected delivery.
                      </p>
                    </div>
                  </div>
                  <div className="evidence-level">
                    <span className="evidence-number">03</span>
                    <div>
                      <strong>Human confirmation</strong>
                      <p>An employee confirms what physically arrived.</p>
                    </div>
                  </div>
                  <div className="evidence-note">
                    Playground Package, Vehicle, and Motion scenes appear in
                    device discovery when available. A sample stream does not
                    generate a verified delivery.
                  </div>
                </section>
              </div>
              <section className="panel activity-panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      Entrance activity{" "}
                      <span className="count-pill">{s.events.length}</span>
                    </h2>
                    <p>Review possible matches before assigning a receiver.</p>
                  </div>
                  {s.demoMode && isManager && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setModal({ type: "test" })}
                    >
                      <Plus size={14} />
                      Local test event
                    </Button>
                  )}
                </div>
                {s.events.length ? (
                  <div className="event-list">
                    {s.events.map((e) => (
                      <button
                        key={e.id}
                        className="event-row"
                        onClick={() => openArrival(e)}
                      >
                        <span className="event-symbol">
                          <Radio size={18} />
                        </span>
                        <div>
                          <strong>
                            {e.type.replaceAll("_", " ")}{" "}
                            <Source value={e.source} />
                          </strong>
                          <small>
                            {e.camera?.location?.name ?? "Unmapped device"} ·
                            reported {dateLabel(e.occurredAt, tz)},{" "}
                            {time(e.occurredAt, tz)} · logged{" "}
                            {time(e.receivedAt, tz)}
                          </small>
                        </div>
                        <span
                          className={cn(
                            "match-label",
                            e.matchStatus === "UNMATCHED" && "unmatched",
                          )}
                        >
                          {e.matchStatus === "LINKED"
                            ? "Task assigned"
                            : e.matchStatus === "SUGGESTED"
                              ? `${e.candidates.length} possible ${e.candidates.length === 1 ? "match" : "matches"}`
                              : "Unmatched activity"}
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <Empty icon={Radio} title="Ready for the next signal">
                    Real signed Ring events and local test events appear here
                    with separate source labels.
                  </Empty>
                )}
              </section>
            </>
          )}
          {section === "Receiving Tasks" && (
            <>
              <div className="tasks-toolbar">
                <div className="segmented">
                  {[
                    ["ALL", "All tasks"],
                    ["PENDING", "Awaiting acknowledgment"],
                    ["RECEIVING", "In progress"],
                    ["RECEIVED", "Completed"],
                    ["EXCEPTION", "Exceptions"],
                  ].map(([v, label]) => (
                    <button
                      className={filter === v ? "selected" : ""}
                      key={v}
                      onClick={() => setFilter(v)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="muted text-sm">
                  Viewing as <strong>{s.actor.name}</strong>
                </span>
              </div>
              <div className="tasks-grid">
                {s.tasks
                  .filter(
                    (t) =>
                      filter === "ALL" ||
                      (filter === "RECEIVING"
                        ? ["ACKNOWLEDGED", "RECEIVING"].includes(t.status)
                        : filter === "EXCEPTION"
                          ? ["EXCEPTION", "ESCALATED"].includes(t.status)
                          : t.status === filter),
                  )
                  .map(taskCard)}
              </div>
              {!s.tasks.length && (
                <section className="panel">
                  <Empty icon={ClipboardCheck} title="A calm receiving desk">
                    Review an entrance activity and select a delivery match to
                    create the first task.
                  </Empty>
                </section>
              )}
            </>
          )}
          {section === "Employees" && (
            <>
              <div className="employee-summary">
                <span>
                  <Users size={19} />
                  <strong>{s.employees.length}</strong>team members
                </span>
                <span>
                  <span className="online-dot" />
                  <strong>
                    {s.employees.filter((e) => e.available).length}
                  </strong>
                  available
                </span>
                <span>
                  <ClipboardCheck size={18} />
                  <strong>{tasks.length}</strong>open tasks
                </span>
              </div>
              <div className="employees-grid">
                {s.employees.map((e) => {
                  const work = s.tasks.filter((t) => t.employeeId === e.id),
                    open = work.filter((t) => t.status !== "RECEIVED"),
                    done = work.filter((t) => t.status === "RECEIVED");
                  const ack = work.filter((t) => t.acknowledgedAt);
                  return (
                    <article className="panel employee-card" key={e.id}>
                      <div className="flex-between">
                        <Avatar name={e.name} />
                        <span
                          className={cn(
                            "availability",
                            !e.available && "unavailable",
                          )}
                        >
                          <span />
                          {e.available ? "Available" : "Unavailable"}
                        </span>
                      </div>
                      <h3>{e.name}</h3>
                      <span className="muted text-sm">
                        {e.role === "MANAGER"
                          ? "Workspace manager"
                          : "Receiving employee"}
                      </span>
                      <div className="employee-locations">
                        {e.locations.map((l) => (
                          <span key={l.locationId}>
                            <MapPin size={12} />
                            {
                              s.locations.find((x) => x.id === l.locationId)
                                ?.name
                            }
                          </span>
                        ))}
                      </div>
                      <div className="employee-metrics">
                        <div>
                          <strong>{open.length}</strong>
                          <small>Open tasks</small>
                        </div>
                        <div>
                          <strong>{done.length}</strong>
                          <small>Completed</small>
                        </div>
                        <div>
                          <strong>
                            {duration(
                              ack.length
                                ? Math.round(
                                    ack.reduce(
                                      (a, t) =>
                                        a +
                                        (new Date(t.acknowledgedAt!).getTime() -
                                          new Date(t.assignedAt).getTime()) /
                                          1000,
                                      0,
                                    ) / ack.length,
                                  )
                                : null,
                            )}
                          </strong>
                          <small>Avg. response</small>
                        </div>
                      </div>
                      {isManager && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setModal({ type: "employee", employee: e })
                          }
                        >
                          <Pencil size={13} />
                          Manage employee
                        </Button>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}
          {section === "Activity History" && (
            <section className="panel">
              <div className="table-toolbar">
                <label className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Search audit history"
                    placeholder="Search action, person, or supplier…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter audit source"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="ALL">All sources</option>
                  <option value="HUMAN">Employee actions</option>
                  <option value="RING_WEBHOOK">Signed Ring webhooks</option>
                  <option value="SIMULATED_RING_WEBHOOK">
                    Simulated webhooks
                  </option>
                  <option value="RING_API">Real Ring API</option>
                  <option value="LOCAL_TEST">Local tests</option>
                  <option value="DEMO_SEED">Demo setup</option>
                </select>
              </div>
              <AuditTimeline
                entries={s.audit.filter(
                  (a) =>
                    (a.message + " " + a.actorName + " " + a.action)
                      .toLowerCase()
                      .includes(query.toLowerCase()) &&
                    (filter === "ALL" || a.source === filter),
                )}
                tz={tz}
                expanded
              />
              <div className="table-bottom">
                Showing the latest 1,000 records. Timestamps record when actions
                actually occurred; reported event times are shown separately.
              </div>
            </section>
          )}
          {section === "Settings" && (
            <SettingsView
              state={s}
              pending={pending}
              onSave={(path, method, data, msg) =>
                mutate(path, method, data, msg, false)
              }
              onError={setError}
            />
          )}
          <footer className="app-footer">
            <span>
              <span className="brand-mini" />
              DeliveryPilot <span className="dot-separator">·</span> Receiving,
              coordinated.
            </span>
            <span>
              {s.demoMode ? "Persistent local demo" : "Private workspace"}{" "}
              <span className="dot-separator">·</span> No video stored
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <Dialog
        open={!!modal}
        onOpenChange={(v) => {
          if (!v) {
            setModal(null);
            setError("");
          }
        }}
      >
        <DialogContent
          className={
            modal?.type === "detail" || modal?.type === "arrival"
              ? "dialog-wide"
              : ""
          }
        >
          {modal?.type === "delivery" && (
            <DeliveryForm
              state={s}
              delivery={modal.delivery}
              pending={pending}
              onSubmit={(d) =>
                mutate(
                  modal.delivery
                    ? `deliveries/${modal.delivery.id}`
                    : "deliveries",
                  modal.delivery ? "PATCH" : "POST",
                  d,
                  "Delivery saved.",
                )
              }
            />
          )}
          {modal?.type === "employee" && (
            <EmployeeForm
              state={s}
              employee={modal.employee}
              pending={pending}
              onSubmit={(d) =>
                mutate(
                  modal.employee
                    ? `employees/${modal.employee.id}`
                    : "employees",
                  modal.employee ? "PATCH" : "POST",
                  d,
                  "Employee saved.",
                )
              }
            />
          )}
          {modal?.type === "test" && (
            <TestForm
              state={s}
              pending={pending}
              onSubmit={async (d) => {
                const result = await mutate(
                  "test-events",
                  "POST",
                  d,
                  "Local test activity logged.",
                );
                navigate("Ring Live");
                return result;
              }}
            />
          )}
          {modal?.type === "arrival" && (
            <ArrivalDetail
              event={
                s.events.find((e) => e.id === modal.event.id) ?? modal.event
              }
              state={s}
              pending={pending}
              onLink={(id) =>
                mutate(
                  `candidates/${id}/link`,
                  "POST",
                  {},
                  "Receiving task created.",
                )
              }
              onTasks={() => {
                setModal(null);
                navigate("Receiving Tasks");
              }}
            />
          )}
          {modal?.type === "detail" && (
            <DeliveryDetail
              delivery={
                s.deliveries.find((d) => d.id === modal.delivery.id) ??
                modal.delivery
              }
              state={s}
              onEdit={() =>
                setModal({ type: "delivery", delivery: modal.delivery })
              }
              onTask={() => {
                setModal(null);
                navigate("Receiving Tasks");
              }}
            />
          )}
          {modal?.type === "archive" && (
            <>
              <DialogTitle>Remove this expected delivery?</DialogTitle>
              <DialogDescription>
                {modal.delivery.supplier} will be removed from the schedule. Its
                audit history is retained.
              </DialogDescription>
              <div className="form-actions">
                <Button variant="outline" onClick={() => setModal(null)}>
                  Keep delivery
                </Button>
                <Button
                  variant="destructive"
                  disabled={pending}
                  onClick={() =>
                    safe(() =>
                      mutate(
                        `deliveries/${modal.delivery.id}`,
                        "DELETE",
                        undefined,
                        "Delivery removed from the schedule.",
                      ),
                    )
                  }
                >
                  Remove delivery
                </Button>
              </div>
            </>
          )}
          {modal?.type === "issue" && (
            <IssueForm
              task={modal.task}
              action={modal.action}
              pending={pending}
              onSubmit={(issue) =>
                mutate(
                  `tasks/${modal.task.id}`,
                  "POST",
                  { action: modal.action, issue },
                  modal.action === "resolve"
                    ? "Issue resolved."
                    : "Problem recorded and manager notified.",
                )
              }
            />
          )}
          {modal?.type === "reassign" && (
            <ReassignForm
              task={modal.task}
              state={s}
              pending={pending}
              onSubmit={(employeeId) =>
                mutate(
                  `tasks/${modal.task.id}`,
                  "POST",
                  { action: "reassign", employeeId },
                  "Task reassigned.",
                )
              }
            />
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function dateKey(value: string, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
    new Date(value),
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-symbol">
        <Package size={21} strokeWidth={1.8} />
        <i />
      </span>
      <span>
        Delivery<span>Pilot</span>
      </span>
    </div>
  );
}
function AuditTimeline({
  entries,
  tz,
  expanded = false,
}: {
  entries: AppState["audit"];
  tz: string;
  expanded?: boolean;
}) {
  return (
    <div className={cn("audit-timeline", expanded && "expanded")}>
      {entries.length ? (
        entries.map((a) => (
          <div className="audit-item" key={a.id}>
            <span
              className={cn(
                "audit-icon",
                a.action === "DELIVERY_CONFIRMED" && "complete",
              )}
            >
              {a.action === "DELIVERY_CONFIRMED" ? (
                <Check size={14} />
              ) : a.action.includes("ACTIVITY") ? (
                <Radio size={14} />
              ) : a.action.includes("EXCEPTION") ||
                a.action.includes("ESCALATED") ? (
                <AlertTriangle size={14} />
              ) : (
                <Package size={14} />
              )}
            </span>
            <div className="audit-content">
              <strong>{a.message}</strong>
              <p>
                <span>{a.actorName}</span>
                <span className="dot-separator">·</span>
                <Source value={a.source} />
                {expanded && (
                  <code>{a.action.toLowerCase().replaceAll("_", " ")}</code>
                )}
              </p>
            </div>
            <time dateTime={a.createdAt}>
              {time(a.createdAt, tz)}
              <small>{dateLabel(a.createdAt, tz)}</small>
            </time>
          </div>
        ))
      ) : (
        <Empty icon={History} title="No activity to show">
          Actions will appear here as the receiving workflow moves forward.
        </Empty>
      )}
    </div>
  );
}
function DeliveryForm({
  state: s,
  delivery: d,
  pending,
  onSubmit,
}: {
  state: AppState;
  delivery?: Delivery;
  pending: boolean;
  onSubmit: (data: unknown) => Promise<unknown>;
}) {
  const [location, setLocation] = useState(
      d?.locationId ?? s.locations[0]?.id ?? "",
    ),
    [employee, setEmployee] = useState(d?.employeeId ?? "");
  const tz = s.business.timezone;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void onSubmit({
      supplier: f.get("supplier"),
      reference: f.get("reference"),
      windowStart: zonedISO(String(f.get("start")), tz),
      windowEnd: zonedISO(String(f.get("end")), tz),
      locationId: location,
      employeeId: employee || null,
      notes: f.get("notes"),
    }).catch(() => {});
  };
  return (
    <>
      <DialogTitle>
        {d ? "Edit expected delivery" : "A new delivery, on the radar."}
      </DialogTitle>
      <DialogDescription>
        Plan who receives it and where. All times use {tz}.
      </DialogDescription>
      <form onSubmit={submit} className="form">
        <div className="form-grid">
          <Field label="Supplier name">
            <input
              name="supplier"
              required
              maxLength={160}
              defaultValue={d?.supplier}
              placeholder="e.g. Northline Supplies"
              autoFocus
            />
          </Field>
          <Field label="Order / reference number">
            <input
              name="reference"
              required
              maxLength={160}
              defaultValue={d?.reference}
              placeholder="e.g. PO-1045"
            />
          </Field>
          <Field label="Expected window starts">
            <input
              name="start"
              type="datetime-local"
              required
              defaultValue={
                d ? localDateTime(d.windowStart, tz) : `${s.today}T14:00`
              }
            />
          </Field>
          <Field label="Expected window ends">
            <input
              name="end"
              type="datetime-local"
              required
              defaultValue={
                d ? localDateTime(d.windowEnd, tz) : `${s.today}T15:00`
              }
            />
          </Field>
          <Field label="Receiving entrance">
            <select
              required
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setEmployee("");
              }}
            >
              {s.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assigned employee">
            <select
              value={employee}
              onChange={(e) => setEmployee(e.target.value)}
            >
              <option value="">Assign later</option>
              {s.employees
                .filter((e) =>
                  e.locations.some((l) => l.locationId === location),
                )
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.available ? "" : " · unavailable"}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label="Delivery notes (optional)">
          <textarea
            name="notes"
            rows={3}
            maxLength={2000}
            defaultValue={d?.notes}
            placeholder="Carton count, access instructions, things to check…"
          />
        </Field>
        <div className="form-info">
          <ShieldCheck size={15} />
          Saving this schedule does not record an arrival or receipt.
        </div>
        <div className="form-actions">
          <Button type="submit" disabled={pending}>
            {pending ? (
              <Loader2 className="spin" size={15} />
            ) : (
              <Plus size={15} />
            )}
            Save delivery
          </Button>
        </div>
      </form>
    </>
  );
}
function EmployeeForm({
  state: s,
  employee: e,
  pending,
  onSubmit,
}: {
  state: AppState;
  employee?: Employee;
  pending: boolean;
  onSubmit: (data: unknown) => Promise<unknown>;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void onSubmit({
      name: f.get("name"),
      role: f.get("role"),
      available: f.get("available") === "on",
      locationIds: f.getAll("locations"),
    }).catch(() => {});
  };
  return (
    <>
      <DialogTitle>
        {e ? "Manage employee" : "Add a receiving teammate"}
      </DialogTitle>
      <DialogDescription>
        Set their role, availability, and receiving entrances.
      </DialogDescription>
      <form onSubmit={submit} className="form">
        <div className="form-grid">
          <Field label="Full name">
            <input
              name="name"
              required
              maxLength={160}
              defaultValue={e?.name}
              autoFocus
            />
          </Field>
          <Field label="Role">
            <select name="role" defaultValue={e?.role ?? "RECEIVER"}>
              <option value="RECEIVER">Receiving employee</option>
              <option value="MANAGER">Workspace manager</option>
            </select>
          </Field>
        </div>
        <fieldset className="location-checks">
          <legend>Receiving entrances</legend>
          {s.locations.map((l) => (
            <label key={l.id}>
              <input
                type="checkbox"
                name="locations"
                value={l.id}
                defaultChecked={
                  e ? e.locations.some((x) => x.locationId === l.id) : true
                }
              />
              <MapPin size={14} />
              {l.name}
            </label>
          ))}
        </fieldset>
        <label className="checkbox-row">
          <input
            type="checkbox"
            name="available"
            defaultChecked={e?.available ?? true}
          />
          <span>Available for receiving assignments</span>
        </label>
        <div className="form-actions">
          <Button type="submit" disabled={pending}>
            Save employee <Check size={15} />
          </Button>
        </div>
      </form>
    </>
  );
}
function TestForm({
  state: s,
  pending,
  onSubmit,
}: {
  state: AppState;
  pending: boolean;
  onSubmit: (data: unknown) => Promise<unknown>;
}) {
  const [scenario, setScenario] = useState("standard");
  const northline = s.deliveries.find((d) => d.id === "northline");
  const defaultTime = northline
    ? new Date(
        new Date(northline.windowStart).getTime() + 20 * 60000,
      ).toISOString()
    : s.serverTime;
  const descriptions: Record<string, string> = {
    standard:
      "Create motion activity at the selected entrance and time. The matching engine checks the schedule.",
    unmatched:
      "Shift the test activity seven days forward to demonstrate an unexpected visitor outside the current schedule.",
    ambiguous:
      "Create an additional expected delivery around this time, then generate activity. Multiple matches require an employee choice.",
    late: "Create an overdue delivery at this entrance, then generate activity at the current time.",
    unavailable:
      "Mark Alex unavailable and generate activity. A selected delivery assigned to Alex will create an unassigned task for manager review.",
    duplicate:
      "Use the fixed request ID local-duplicate-example. Repeat this scenario to verify that the event is processed only once.",
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void onSubmit({
      cameraId: f.get("cameraId"),
      type: f.get("type"),
      occurredAt: zonedISO(String(f.get("at")), s.business.timezone),
      scenario,
    }).catch(() => {});
  };
  return (
    <>
      <DialogTitle>Create local test activity</DialogTitle>
      <DialogDescription>
        This is a manually generated event. It is never labeled as a Ring
        webhook or video detection.
      </DialogDescription>
      <form className="form" onSubmit={submit}>
        <div className="test-warning">
          <Radio size={18} />
          <div>
            <strong>Local test source</strong>
            <p>
              Use this alongside a Playground sample when actual webhook
              delivery is unavailable.
            </p>
          </div>
        </div>
        <Field label="Test scenario">
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
          >
            {[
              ["standard", "Expected arrival"],
              ["unmatched", "Unexpected visitor / motion"],
              ["ambiguous", "Multiple possible matches"],
              ["late", "Late delivery"],
              ["unavailable", "Employee unavailable"],
              ["duplicate", "Duplicate incoming request"],
            ].map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <p className="scenario-description">{descriptions[scenario]}</p>
        <div className="form-grid">
          <Field label="Test entrance">
            <select name="cameraId">
              {s.cameras
                .filter((c) => c.source === "LOCAL_TEST")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.location?.name ?? c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Activity type">
            <select name="type">
              <option value="motion_detected">Motion detected</option>
              <option value="button_press">Button press</option>
            </select>
          </Field>
        </div>
        <Field
          label={`Simulated event time (${s.business.timezone})`}
          hint="Reported event time is simulated. The audit log records the actual time you create it."
        >
          <input
            name="at"
            type="datetime-local"
            required
            defaultValue={localDateTime(defaultTime, s.business.timezone)}
          />
        </Field>
        <div className="form-actions">
          <Button type="submit" disabled={pending}>
            <Radio size={15} />
            Generate local test event
          </Button>
        </div>
      </form>
    </>
  );
}
function ArrivalDetail({
  event: e,
  state: s,
  pending,
  onLink,
  onTasks,
}: {
  event: Arrival;
  state: AppState;
  pending: boolean;
  onLink: (id: string) => Promise<unknown>;
  onTasks: () => void;
}) {
  const manager = s.actor.role === "MANAGER";
  return (
    <>
      <DialogTitle>Review entrance activity</DialogTitle>
      <DialogDescription>
        Choose the schedule entry that may correspond to this activity. A match
        does not confirm receipt.
      </DialogDescription>
      <div className="arrival-summary">
        <span className="event-symbol">
          <Radio size={22} />
        </span>
        <div>
          <strong>{e.type.replaceAll("_", " ")}</strong>
          <p>
            {e.camera?.location?.name ?? "Unmapped device"} ·{" "}
            {dateLabel(e.occurredAt, s.business.timezone)},{" "}
            {time(e.occurredAt, s.business.timezone)}
          </p>
          <Source value={e.source} />
        </div>
      </div>
      <p className="evidence-caption">{e.summary}</p>
      <h3 className="subheading">
        {e.candidates.length
          ? "Suggested schedule matches"
          : "Unmatched activity"}
      </h3>
      {e.candidates.length ? (
        e.candidates.map((c) => {
          const unavailable =
            c.delivery.employeeId &&
            !s.employees.find((x) => x.id === c.delivery.employeeId)?.available;
          return (
            <article className="candidate-card" key={c.id}>
              <div className="flex-between">
                <div>
                  <strong>{c.delivery.supplier}</strong>
                  <small>
                    {c.delivery.reference} ·{" "}
                    {time(c.delivery.windowStart, s.business.timezone)} –{" "}
                    {time(c.delivery.windowEnd, s.business.timezone)}
                  </small>
                </div>
                <span className="score">
                  {c.score}/100 <small>rule score</small>
                </span>
              </div>
              <ul>
                {(JSON.parse(c.reasons) as string[]).map((reason) => (
                  <li key={reason}>
                    <Check size={13} />
                    {reason}
                  </li>
                ))}
              </ul>
              {unavailable && (
                <p className="unavailable-note">
                  <AlertTriangle size={14} />
                  Assigned employee unavailable. A manager will need to assign
                  this task.
                </p>
              )}
              {c.selected ? (
                <div className="selected-match">
                  <CheckCheck size={15} />
                  Selected · receiving task created
                </div>
              ) : e.matchStatus === "LINKED" ? (
                <p className="muted text-sm">
                  Another match was selected for this activity.
                </p>
              ) : manager ? (
                <Button
                  disabled={
                    pending ||
                    c.delivery.archived ||
                    !["EXPECTED", "DELAYED", "POSSIBLE_ARRIVAL"].includes(
                      c.delivery.status,
                    )
                  }
                  size="sm"
                  onClick={() => void onLink(c.id).catch(() => {})}
                >
                  Select match & assign task <ArrowRight size={14} />
                </Button>
              ) : (
                <p className="muted text-sm">
                  A manager must select the delivery match.
                </p>
              )}
            </article>
          );
        })
      ) : (
        <div className="unmatched-box">
          <Unplug size={22} />
          <p>
            No eligible expected delivery matched this entrance and time. A
            manager can inspect the activity and update the schedule.
          </p>
        </div>
      )}
      <div className="form-info">
        <ShieldCheck size={15} />
        Supplier and order identity are not recognized from video.
      </div>
      {e.matchStatus === "LINKED" && (
        <div className="form-actions">
          <Button onClick={onTasks}>
            Open receiving tasks <ArrowRight size={14} />
          </Button>
        </div>
      )}
    </>
  );
}
function DeliveryDetail({
  delivery: d,
  state: s,
  onEdit,
  onTask,
}: {
  delivery: Delivery;
  state: AppState;
  onEdit: () => void;
  onTask: () => void;
}) {
  const task = s.tasks.find((t) => t.deliveryId === d.id);
  const eventIds = new Set(
    s.events
      .filter((e) =>
        e.candidates.some((c) => c.deliveryId === d.id && c.selected),
      )
      .map((e) => e.id),
  );
  const tz = s.business.timezone;
  return (
    <>
      <div className="detail-heading">
        <span className="supplier-icon">
          <Box size={24} />
        </span>
        <div>
          <DialogTitle>{d.supplier}</DialogTitle>
          <DialogDescription>{d.reference}</DialogDescription>
        </div>
        <Badge status={effectiveStatus(d, s.serverTime)} />
      </div>
      <div className="detail-grid">
        <div>
          <small>EXPECTED WINDOW</small>
          <strong>
            {dateLabel(d.windowStart, tz)} · {time(d.windowStart, tz)} –{" "}
            {time(d.windowEnd, tz)}
          </strong>
        </div>
        <div>
          <small>RECEIVING ENTRANCE</small>
          <strong>{d.location.name}</strong>
        </div>
        <div>
          <small>ASSIGNED EMPLOYEE</small>
          <strong>{d.employee?.name ?? "Unassigned"}</strong>
        </div>
        <div>
          <small>RECEIPT CONFIRMATION</small>
          <strong>
            {d.receivedAt
              ? `${dateLabel(d.receivedAt, tz)} · ${time(d.receivedAt, tz)}`
              : "Awaiting human confirmation"}
          </strong>
        </div>
      </div>
      {d.notes && (
        <div className="detail-notes">
          <small>DELIVERY NOTES</small>
          <p>{d.notes}</p>
        </div>
      )}
      <div className="detail-actions">
        {task ? (
          <Button onClick={onTask}>
            Open receiving task <ArrowRight size={14} />
          </Button>
        ) : (
          s.actor.role === "MANAGER" && (
            <Button variant="outline" onClick={onEdit}>
              <Pencil size={14} />
              Edit delivery
            </Button>
          )
        )}
      </div>
      <h3 className="subheading">Delivery audit trail</h3>
      <AuditTimeline
        entries={s.audit.filter(
          (a) =>
            a.deliveryId === d.id || !!(a.eventId && eventIds.has(a.eventId)),
        )}
        tz={tz}
      />
    </>
  );
}
function IssueForm({
  task: t,
  action,
  pending,
  onSubmit,
}: {
  task: Task;
  action: "exception" | "escalate" | "resolve";
  pending: boolean;
  onSubmit: (issue: string) => Promise<unknown>;
}) {
  return (
    <>
      <DialogTitle>
        {action === "resolve"
          ? "Resolve receiving issue"
          : action === "escalate"
            ? "Escalate to a manager"
            : "Report a receiving problem"}
      </DialogTitle>
      <DialogDescription>
        {t.delivery.supplier} · {t.delivery.reference}. Your name and the
        current timestamp will be recorded.
      </DialogDescription>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(
            String(new FormData(e.currentTarget).get("issue")),
          ).catch(() => {});
        }}
      >
        <Field
          label={
            action === "resolve" ? "How was this resolved?" : "What happened?"
          }
        >
          <textarea
            name="issue"
            required
            maxLength={2000}
            rows={4}
            autoFocus
            placeholder={
              action === "resolve"
                ? "Describe the resolution…"
                : "Missing cartons, damaged items, access problem…"
            }
          />
        </Field>
        <div className="form-actions">
          <Button disabled={pending}>
            {action === "resolve" ? "Resolve issue" : "Record & notify manager"}{" "}
            <Send size={14} />
          </Button>
        </div>
      </form>
    </>
  );
}
function ReassignForm({
  task: t,
  state: s,
  pending,
  onSubmit,
}: {
  task: Task;
  state: AppState;
  pending: boolean;
  onSubmit: (employeeId: string) => Promise<unknown>;
}) {
  const employees = s.employees.filter(
    (e) =>
      e.available &&
      e.locations.some((l) => l.locationId === t.delivery.locationId),
  );
  return (
    <>
      <DialogTitle>Assign a receiving employee</DialogTitle>
      <DialogDescription>
        {t.delivery.supplier} · {t.delivery.location.name}. Reassignment
        restarts the acknowledgment timer and is recorded in the audit log.
      </DialogDescription>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(
            String(new FormData(e.currentTarget).get("employee")),
          ).catch(() => {});
        }}
      >
        <Field label="Available employee">
          <select
            name="employee"
            required
            defaultValue={
              employees.some((e) => e.id === t.employeeId) ? t.employeeId! : ""
            }
          >
            <option value="" disabled>
              Choose an employee
            </option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        {!employees.length && (
          <p className="form-error">
            No available employees receive at this entrance. Update Employees
            first.
          </p>
        )}
        <div className="form-actions">
          <Button disabled={pending || !employees.length}>
            Assign task <ArrowRight size={14} />
          </Button>
        </div>
      </form>
    </>
  );
}
function SettingsView({
  state: s,
  pending,
  onSave,
  onError,
}: {
  state: AppState;
  pending: boolean;
  onSave: (
    path: string,
    method: string,
    data: unknown,
    message: string,
  ) => Promise<unknown>;
  onError: (error: string) => void;
}) {
  const isManager = s.actor.role === "MANAGER";
  const run = (f: () => Promise<unknown>) =>
    void f().catch((e) =>
      onError(e instanceof Error ? e.message : "Settings update failed."),
    );
  return (
    <div className="settings-grid">
      <section className="panel settings-card">
        <div className="panel-heading">
          <div>
            <h2>Ring connection</h2>
            <p>Credentials stay on your Next.js server.</p>
          </div>
          <span className="ring-mark">ring</span>
        </div>
        <div className="settings-inner">
          <div className="integration-status">
            <span
              className={s.checks[0]?.success ? "online-dot" : "neutral-dot"}
            />
            <strong>
              {s.checks[0]?.success
                ? "Live API discovery verified"
                : s.integration.configured
                  ? "Configured · verify connection"
                  : "Not connected"}
            </strong>
          </div>
          <dl className="settings-dl">
            <div>
              <dt>Authentication mode</dt>
              <dd>{s.integration.mode}</dd>
            </div>
            <div>
              <dt>Partner signing credentials</dt>
              <dd>
                {s.integration.webhookConfigured
                  ? "Configured"
                  : "Not configured"}
              </dd>
            </div>
            <div>
              <dt>Webhook processing mode</dt>
              <dd>
                {s.integration.webhookMode === "simulated"
                  ? "Simulated · local test events"
                  : "Partner notifications"}
              </dd>
            </div>
            <div>
              <dt>Real devices discovered</dt>
              <dd>{s.cameras.filter((c) => c.source === "RING_API").length}</dd>
            </div>
          </dl>
          <div className="config-instructions">
            <strong>Connect the Developer Playground</strong>
            <ol>
              <li>
                Generate a token in the{" "}
                <a
                  href="https://developer.amazon.com/ring/console/playground"
                  target="_blank"
                  rel="noreferrer"
                >
                  Ring Playground <ExternalLink size={11} />
                </a>
                .
              </li>
              <li>
                Set <code>RING_ACCESS_TOKEN</code> in your server’s{" "}
                <code>.env.local</code>.
              </li>
              <li>Restart Next.js, then verify the connection below.</li>
            </ol>
            <small>
              Tokens are short-lived. Do not paste secrets into this dashboard.
            </small>
          </div>
          {isManager && (
            <Button
              disabled={pending}
              onClick={() =>
                run(() =>
                  onSave(
                    "ring/connect",
                    "POST",
                    {},
                    "Real Ring discovery completed.",
                  ),
                )
              }
            >
              <RefreshCw size={15} />
              Verify & discover devices
            </Button>
          )}
          {s.checks.length > 0 && (
            <div className="connection-checks">
              <h3>Recent connection checks</h3>
              {s.checks.map((c) => (
                <div key={c.id}>
                  <span className={c.success ? "check-pass" : "check-fail"}>
                    {c.success ? (
                      <CheckCircle2 size={14} />
                    ) : (
                      <AlertCircle size={14} />
                    )}
                  </span>
                  <span>
                    <strong>{c.message}</strong>
                    <small>
                      {c.endpoint} ·{" "}
                      {dateLabel(c.createdAt, s.business.timezone)}{" "}
                      {time(c.createdAt, s.business.timezone)}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      <section className="panel settings-card">
        <div className="panel-heading">
          <div>
            <h2>Notifications & time</h2>
            <p>Define the receiving team’s response window.</p>
          </div>
          <Bell size={18} />
        </div>
        <form
          className="settings-inner form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(() =>
              onSave(
                "settings",
                "PATCH",
                {
                  timezone: f.get("timezone"),
                  notificationsEnabled: f.get("notifications") === "on",
                  acknowledgmentMinutes: Number(f.get("minutes")),
                },
                "Workspace settings updated.",
              ),
            );
          }}
        >
          <Field label="Business time zone">
            <input
              name="timezone"
              required
              defaultValue={s.business.timezone}
              disabled={!isManager}
            />
          </Field>
          <Field
            label="Acknowledgment target (minutes)"
            hint="Tasks exceeding this target display an overdue indicator."
          >
            <input
              name="minutes"
              type="number"
              min={1}
              max={120}
              required
              defaultValue={s.business.acknowledgmentMinutes}
              disabled={!isManager}
            />
          </Field>
          <label className="checkbox-row">
            <input
              type="checkbox"
              name="notifications"
              defaultChecked={s.business.notificationsEnabled}
              disabled={!isManager}
            />
            <span>Send in-app receiving notifications</span>
          </label>
          <p className="muted text-sm">
            Manager notifications cover new arrival candidates, unassigned
            tasks, and reported issues.
          </p>
          {isManager && (
            <Button variant="outline" disabled={pending} type="submit">
              Save preferences <Check size={14} />
            </Button>
          )}
        </form>
      </section>
      <section className="panel settings-card">
        <div className="panel-heading">
          <div>
            <h2>Camera → entrance mapping</h2>
            <p>A camera must be mapped before events can match deliveries.</p>
          </div>
          <Camera size={18} />
        </div>
        <div className="settings-inner camera-mappings">
          {s.cameras.map((c) => (
            <div key={c.id}>
              <div>
                <strong>{c.name}</strong>
                <Source value={c.source} />
              </div>
              <select
                aria-label={`Receiving location for ${c.name}`}
                value={c.locationId ?? ""}
                disabled={!isManager || pending}
                onChange={(e) =>
                  run(() =>
                    onSave(
                      `cameras/${c.id}`,
                      "PATCH",
                      { locationId: e.target.value || null },
                      "Camera entrance mapping saved.",
                    ),
                  )
                }
              >
                <option value="">Unmapped</option>
                {s.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>
      <section className="panel settings-card">
        <div className="panel-heading">
          <div>
            <h2>Receiving entrances</h2>
            <p>Locations used for matching and employee assignment.</p>
          </div>
          <MapPin size={18} />
        </div>
        <div className="settings-inner">
          <div className="location-list">
            {s.locations.map((l) => (
              <div key={l.id}>
                <MapPin size={16} />
                <strong>{l.name}</strong>
                <span>
                  {s.cameras.filter((c) => c.locationId === l.id).length}{" "}
                  cameras
                </span>
              </div>
            ))}
          </div>
          {isManager && (
            <form
              className="add-location"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const name = new FormData(form).get("name");
                run(async () => {
                  await onSave(
                    "locations",
                    "POST",
                    { name },
                    "Receiving entrance created.",
                  );
                  form.reset();
                });
              }}
            >
              <input
                name="name"
                required
                maxLength={100}
                aria-label="New entrance name"
                placeholder="New receiving entrance"
              />
              <Button
                variant="outline"
                disabled={pending}
                aria-label="Add receiving entrance"
              >
                <Plus size={16} />
              </Button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
