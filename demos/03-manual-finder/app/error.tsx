"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty">
      <h2>Let&rsquo;s try that again.</h2>
      <p>This page hit a problem. Your library is still saved.</p>
      <button type="button" className="btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
