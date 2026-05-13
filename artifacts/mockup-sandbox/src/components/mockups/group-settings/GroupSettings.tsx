import { useState } from "react";

const options = {
  category: ["Study & Exam Prep", "Language Learning", "Coding & Dev", "Science & Math", "Arts & Design", "Health & Fitness"],
  dailyGoal: ["2h", "4h", "6h", "8h", "10h", "12h"],
  capacity: ["2 people", "5 people", "10 people", "20 people", "Unlimited"],
  joinMethod: ["Public", "Join after approval", "Password required"],
  visibility: ["Public", "Private", "Hidden"],
  promoteChips: ["1h", "5h", "24h"],
};

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-4 pt-5 pb-2">
      <span style={{ fontSize: 11, fontWeight: 700, color: "#8a8a8e", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </span>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.06)", marginLeft: 16 }} />;
}

function RowChevron() {
  return <span style={{ color: "#3a3a3c", fontSize: 18, lineHeight: 1 }}>›</span>;
}

function RadioRow({
  label,
  options: opts,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="flex items-center justify-between px-4 cursor-pointer"
        style={{ minHeight: 52, background: "transparent" }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ fontSize: 15, fontWeight: 500, color: "#f2f2f7" }}>{label}</span>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 14, color: "#8a8a8e" }}>{value}</span>
          <span style={{ color: "#3a3a3c", fontSize: 18, lineHeight: 1, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</span>
        </div>
      </div>
      {open && (
        <div style={{ background: "rgba(255,255,255,0.04)", borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: 4 }}>
          {opts.map((opt) => (
            <div
              key={opt}
              className="flex items-center justify-between px-6 cursor-pointer"
              style={{ minHeight: 44 }}
              onClick={() => { onChange(opt); setOpen(false); }}
            >
              <span style={{ fontSize: 14, color: opt === value ? "#ff9f0a" : "#aeaeb2" }}>{opt}</span>
              {opt === value && (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8L6.5 11.5L13 4.5" stroke="#ff9f0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function PillRow({ label, options: opts, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="px-4" style={{ minHeight: 64, display: "flex", flexDirection: "column", justifyContent: "center", gap: 10 }}>
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 15, fontWeight: 500, color: "#f2f2f7" }}>{label}</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        {opts.map((opt) => {
          const selected = opt === value;
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              style={{
                padding: "5px 14px",
                borderRadius: 20,
                border: selected ? "1.5px solid #ff9f0a" : "1.5px solid rgba(255,255,255,0.1)",
                background: selected ? "rgba(255,159,10,0.14)" : "rgba(255,255,255,0.05)",
                color: selected ? "#ff9f0a" : "#8a8a8e",
                fontSize: 13,
                fontWeight: selected ? 700 : 500,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between px-4" style={{ minHeight: 52 }}>
      <span style={{ fontSize: 15, fontWeight: 500, color: "#f2f2f7" }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 50,
          height: 28,
          borderRadius: 14,
          border: "none",
          background: value ? "#ff9f0a" : "#39393d",
          position: "relative",
          cursor: "pointer",
          transition: "background 0.2s",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: value ? 25 : 3,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
            transition: "left 0.2s",
          }}
        />
      </button>
    </div>
  );
}

function NavigationRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between px-4 cursor-pointer" style={{ minHeight: 52 }}>
      <span style={{ fontSize: 15, fontWeight: 500, color: "#f2f2f7" }}>{label}</span>
      <div className="flex items-center gap-2">
        {value && <span style={{ fontSize: 14, color: "#8a8a8e" }}>{value}</span>}
        <RowChevron />
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#1c1c1e",
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
        border: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      {children}
    </div>
  );
}

export function GroupSettings() {
  const [groupName, setGroupName] = useState("Duo series  partn...");
  const [introduction, setIntroduction] = useState("Duo series  partn...");
  const [category, setCategory] = useState("Study & Exam Prep");
  const [dailyGoal, setDailyGoal] = useState("10h");
  const [capacity, setCapacity] = useState("2 people");
  const [joinMethod, setJoinMethod] = useState("Join after approval");
  const [signUpQuestions, setSignUpQuestions] = useState(true);
  const [nicknameRules, setNicknameRules] = useState(true);
  const [visibility, setVisibility] = useState("Public");
  const [groupChat, setGroupChat] = useState(true);
  const [promote, setPromote] = useState("5h");
  const [editingName, setEditingName] = useState(false);

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: "#000",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {/* Status bar spacer */}
      <div style={{ height: 44 }} />

      {/* Nav header */}
      <div className="flex items-center px-4 mb-2" style={{ height: 44 }}>
        <button style={{ background: "none", border: "none", color: "#ff9f0a", fontSize: 16, cursor: "pointer", padding: 0, marginRight: "auto" }}>
          ‹ Back
        </button>
        <span style={{ fontSize: 17, fontWeight: 600, color: "#f2f2f7", position: "absolute", left: "50%", transform: "translateX(-50%)" }}>
          Group Info/Settings
        </span>
        <button style={{ background: "none", border: "none", color: "#ff9f0a", fontSize: 15, fontWeight: 600, cursor: "pointer", padding: 0, marginLeft: "auto" }}>
          Save
        </button>
      </div>

      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 0 }}>

        {/* SECTION 1 */}
        <SectionLabel label="Group Leader Menu" />

        <Card>
          {/* Group Name */}
          <div className="flex items-center justify-between px-4" style={{ minHeight: 52 }}>
            <span style={{ fontSize: 15, fontWeight: 500, color: "#f2f2f7" }}>Group Name</span>
            {editingName ? (
              <input
                autoFocus
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onBlur={() => setEditingName(false)}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,159,10,0.5)",
                  borderRadius: 8,
                  color: "#f2f2f7",
                  fontSize: 14,
                  padding: "4px 10px",
                  outline: "none",
                  width: 160,
                  textAlign: "right",
                }}
              />
            ) : (
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => setEditingName(true)}>
                <span style={{ fontSize: 14, color: "#8a8a8e", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupName}</span>
                <RowChevron />
              </div>
            )}
          </div>

          <Divider />

          {/* Introduction */}
          <div className="flex items-center justify-between px-4 cursor-pointer" style={{ minHeight: 52 }}>
            <span style={{ fontSize: 15, fontWeight: 500, color: "#f2f2f7" }}>Group Introduction/Rules</span>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 14, color: "#8a8a8e", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{introduction}</span>
              <RowChevron />
            </div>
          </div>

          <Divider />

          {/* Category */}
          <RadioRow label="Change Category" options={options.category} value={category} onChange={setCategory} />

          <Divider />

          {/* Daily Goal */}
          <PillRow label="Change Daily Goal" options={options.dailyGoal} value={dailyGoal} onChange={setDailyGoal} />

          <Divider />

          {/* Capacity */}
          <RadioRow label="Change Capacity" options={options.capacity} value={capacity} onChange={setCapacity} />

          <Divider />

          {/* How to Join */}
          <RadioRow label="How to Join" options={options.joinMethod} value={joinMethod} onChange={setJoinMethod} />

          <Divider />

          {/* Sign Up Questions */}
          <ToggleRow label="Sign Up Questions" value={signUpQuestions} onChange={setSignUpQuestions} />

          <Divider />

          {/* Nickname Rules */}
          <ToggleRow label="Nickname Rules" value={nicknameRules} onChange={setNicknameRules} />

          <Divider />

          {/* Group Visibility */}
          <RadioRow label="Group Visibility" options={options.visibility} value={visibility} onChange={setVisibility} />
        </Card>

        {/* SECTION 2 */}
        <SectionLabel label="Management" />

        <Card>
          <NavigationRow label="Waiting Room" />
          <Divider />
          <NavigationRow label="Manage Group Members" />
          <Divider />
          <NavigationRow label="Nudge everyone at once" />
          <Divider />
          <ToggleRow label="Group Chat" value={groupChat} onChange={setGroupChat} />
          <Divider />
          {/* Promote */}
          <PillRow
            label="Promote Group"
            options={options.promoteChips}
            value={promote}
            onChange={setPromote}
          />
        </Card>

        {/* DANGER ZONE */}
        <div style={{ margin: "20px 0 40px" }}>
          <button
            style={{
              width: "100%",
              padding: "16px",
              borderRadius: 14,
              border: "1.5px solid rgba(255,69,58,0.35)",
              background: "rgba(255,69,58,0.08)",
              color: "#ff453a",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: "0.01em",
              boxShadow: "0 2px 12px rgba(255,69,58,0.1)",
              transition: "background 0.15s",
            }}
          >
            Delete Group
          </button>
        </div>

      </div>
    </div>
  );
}
