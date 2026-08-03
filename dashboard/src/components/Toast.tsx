export function Toast({ msg }: { msg: string }) {
  return (
    <div className="toast" role="status">
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
      {msg}
    </div>
  );
}
