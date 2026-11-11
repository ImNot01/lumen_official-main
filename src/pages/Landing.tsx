import { Link } from 'react-router-dom'
import { Logo, ThemeToggle } from '../components/ui'

const features = [
  {
    title: 'Private by design',
    body: 'Every conversation stays strictly between you and the people you choose. No one else can read it.',
  },
  {
    title: 'Real-time',
    body: 'Messages, typing indicators and read receipts arrive instantly, without ever refreshing the page.',
  },
  {
    title: 'Any device',
    body: 'Lumen runs right in your browser on desktop, tablet and phone. Nothing to install.',
  },
  {
    title: 'Always free',
    body: 'No subscriptions, no ads, no catches. Lumen is free to use.',
  },
]

function Bubble({ mine, text }: { mine?: boolean; text: string }) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm leading-snug ${
          mine
            ? 'bg-brand-700 text-white dark:bg-brand-500 dark:text-slate-950'
            : 'border border-slate-200 bg-white text-slate-800 dark:border-transparent dark:bg-white/10 dark:text-slate-100'
        }`}
      >
        {text}
      </div>
    </div>
  )
}

export default function Landing() {
  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl" />

      <header
        className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-2.5">
          <Logo size={34} />
          <span className="text-lg font-semibold tracking-tight">Lumen</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <Link to="/login" className="btn-ghost px-3.5 py-2 text-sm sm:px-4">Log in</Link>
          <Link to="/register" className="btn-primary px-3.5 py-2 text-sm sm:px-4">Sign up</Link>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
        <section className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="animate-fade-in">
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              Message the people who matter.<span className="text-brand-600 dark:text-brand-400"> Nothing else.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-slate-600 dark:text-slate-300">
              Lumen is a clean, private space for real conversations. Fast, real-time and built to feel calm.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/register" className="btn-primary px-6 py-3.5 text-base">Create free account</Link>
              <Link to="/login" className="btn-ghost px-6 py-3.5 text-base">I already have an account</Link>
            </div>
          </div>

          <div className="glass animate-fade-in mx-auto w-full max-w-sm space-y-2.5 p-5" style={{ animationDelay: '0.1s' }} aria-hidden="true">
            <div className="mb-1 flex items-center gap-3 border-b border-slate-200/70 pb-3 dark:border-white/10">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white dark:bg-brand-500 dark:text-slate-950">M</div>
              <div>
                <p className="text-sm font-semibold">Maya</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Online</p>
              </div>
            </div>
            <Bubble text="Hey! Are we still on for Saturday?" />
            <Bubble mine text="Wouldn't miss it 🙂" />
            <Bubble text="Perfect, see you then!" />
            <Bubble mine text="See you soon" />
          </div>
        </section>

        <section className="mt-24 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f, i) => (
            <div key={f.title} className="glass animate-fade-in p-6" style={{ animationDelay: `${i * 0.07}s` }}>
              <h2 className="text-base font-semibold">{f.title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">{f.body}</p>
            </div>
          ))}
        </section>

        <section className="glass animate-fade-in mt-24 flex flex-col items-center gap-4 p-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Ready to start messaging?</h2>
          <p className="max-w-sm text-slate-600 dark:text-slate-300">It takes less than a minute to create your account.</p>
          <Link to="/register" className="btn-primary px-8 py-3.5 text-base">Create free account</Link>
        </section>
      </main>

      <footer className="relative mx-auto max-w-6xl px-4 pb-10 text-center text-sm text-slate-500 sm:px-6 dark:text-slate-400">
        © {new Date().getFullYear()} Lumen
      </footer>
    </div>
  )
}
