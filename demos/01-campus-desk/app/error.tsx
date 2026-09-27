"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <h1>Let’s try that again.</h1>
      <p>Campus Desk couldn’t load. Your document is still in this browser.</p>
      <button className="primary-button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
