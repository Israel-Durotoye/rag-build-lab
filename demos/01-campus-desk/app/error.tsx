"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty">
      <h2>Let&rsquo;s try that again.</h2>
      <p>This page hit a problem. Your documents are still saved.</p>
      <button type="button" className="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
