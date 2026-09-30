"use client"

import { Hero } from "./landing/hero"
import { CTASection, Guarantees, HowItWorks, VerdictSection } from "./landing/sections"
import { useAuth } from "./auth-provider"
import { Footer } from "./footer"
import { Navbar } from "./navbar"

/** The public landing page. */
export function Hero3DStage() {
  const { user, loading } = useAuth()
  return (
    <div className="bg-background">
      <Navbar />
      <Hero signedIn={!loading && !!user} />
      <HowItWorks />
      <VerdictSection />
      <Guarantees />
      <CTASection />
      <Footer />
    </div>
  )
}
