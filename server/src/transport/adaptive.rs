use std::collections::VecDeque;
use std::time::Duration;

// ── Quality Tiers ───────────────────────────────────────────────────────────

/// Adaptive quality tier based on RTT measurement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QualityTier {
    /// <50ms RTT: 120Hz, all events, no batching.
    Full,
    /// 50-150ms RTT: 30Hz, batched events.
    Batched,
    /// >150ms RTT: 10Hz, critical events only.
    Critical,
}

impl QualityTier {
    /// Classify a single RTT sample into a tier.
    fn from_rtt(rtt: Duration) -> Self {
        let ms = rtt.as_millis();
        if ms < 50 {
            Self::Full
        } else if ms <= 150 {
            Self::Batched
        } else {
            Self::Critical
        }
    }
}

// ── RTT Thresholds ──────────────────────────────────────────────────────────

/// Number of RTT samples in the sliding window.
const WINDOW_SIZE: usize = 10;

/// Consecutive samples needed to trigger a tier change (hysteresis).
const HYSTERESIS_COUNT: usize = 3;

// ── Adaptive Quality Controller ─────────────────────────────────────────────

/// RTT-based adaptive quality controller.
///
/// Measures RTT via QUIC stats and adjusts event streaming quality:
/// - `Full`: all events at 120Hz
/// - `Batched`: aggregate into 33ms batches at 30Hz
/// - `Critical`: only critical events at 10Hz (100ms batches)
///
/// Uses hysteresis (3 consecutive samples) to avoid flapping.
pub struct AdaptiveQuality {
    /// Current active tier.
    current_tier: QualityTier,
    /// Sliding window of recent RTT measurements.
    rtt_samples: VecDeque<Duration>,
    /// Count of consecutive samples suggesting a different tier.
    consecutive_different: usize,
    /// The tier those consecutive samples suggest.
    pending_tier: QualityTier,
}

impl AdaptiveQuality {
    /// Create a new quality controller, starting at `Full` tier.
    pub fn new() -> Self {
        Self {
            current_tier: QualityTier::Full,
            rtt_samples: VecDeque::with_capacity(WINDOW_SIZE),
            consecutive_different: 0,
            pending_tier: QualityTier::Full,
        }
    }

    /// Record a new RTT sample and potentially switch tier.
    pub fn update_rtt(&mut self, rtt: Duration) {
        // Maintain sliding window
        if self.rtt_samples.len() >= WINDOW_SIZE {
            self.rtt_samples.pop_front();
        }
        self.rtt_samples.push_back(rtt);

        // Determine tier for this sample
        let sample_tier = QualityTier::from_rtt(rtt);

        // Hysteresis: need HYSTERESIS_COUNT consecutive samples at a
        // different tier before switching.
        if sample_tier != self.current_tier {
            if sample_tier == self.pending_tier {
                self.consecutive_different += 1;
            } else {
                self.pending_tier = sample_tier;
                self.consecutive_different = 1;
            }

            if self.consecutive_different >= HYSTERESIS_COUNT {
                self.current_tier = self.pending_tier;
                self.consecutive_different = 0;
            }
        } else {
            // Same as current — reset hysteresis counter
            self.consecutive_different = 0;
            self.pending_tier = self.current_tier;
        }
    }

    /// Get the current quality tier.
    pub fn current_tier(&self) -> QualityTier {
        self.current_tier
    }

    /// Whether an event on the given topic should be sent at the current tier.
    ///
    /// - `Full`: all events
    /// - `Batched`: all events (but caller should batch them)
    /// - `Critical`: only `session/messages` and `system/events`
    pub fn should_send(&self, topic: &str) -> bool {
        match self.current_tier {
            QualityTier::Full | QualityTier::Batched => true,
            QualityTier::Critical => {
                matches!(topic, "session/messages" | "system/events")
            }
        }
    }

    /// Get the batch interval for the current tier.
    pub fn batch_interval(&self) -> Duration {
        match self.current_tier {
            QualityTier::Full => Duration::ZERO,
            QualityTier::Batched => Duration::from_millis(33), // ~30Hz
            QualityTier::Critical => Duration::from_millis(100), // ~10Hz
        }
    }

    /// Get the average RTT from the sliding window, or `None` if no samples.
    pub fn average_rtt(&self) -> Option<Duration> {
        if self.rtt_samples.is_empty() {
            return None;
        }
        let total: Duration = self.rtt_samples.iter().sum();
        Some(total / self.rtt_samples.len() as u32)
    }

    /// Number of RTT samples currently in the window.
    pub fn sample_count(&self) -> usize {
        self.rtt_samples.len()
    }
}

impl Default for AdaptiveQuality {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_at_full_tier() {
        let aq = AdaptiveQuality::new();
        assert_eq!(aq.current_tier(), QualityTier::Full);
        assert_eq!(aq.batch_interval(), Duration::ZERO);
    }

    #[test]
    fn full_tier_sends_all_topics() {
        let aq = AdaptiveQuality::new();
        assert!(aq.should_send("session/messages"));
        assert!(aq.should_send("files/changes"));
        assert!(aq.should_send("system/events"));
        assert!(aq.should_send("tasks/updates"));
        assert!(aq.should_send("agents/metrics"));
    }

    #[test]
    fn hysteresis_prevents_single_sample_switch() {
        let mut aq = AdaptiveQuality::new();

        // One high RTT sample should NOT switch tier
        aq.update_rtt(Duration::from_millis(200));
        assert_eq!(aq.current_tier(), QualityTier::Full);

        // Two high RTT samples — still not enough
        aq.update_rtt(Duration::from_millis(200));
        assert_eq!(aq.current_tier(), QualityTier::Full);
    }

    #[test]
    fn switches_after_hysteresis_count() {
        let mut aq = AdaptiveQuality::new();

        // Three consecutive Critical samples → switch
        for _ in 0..HYSTERESIS_COUNT {
            aq.update_rtt(Duration::from_millis(200));
        }
        assert_eq!(aq.current_tier(), QualityTier::Critical);
        assert_eq!(aq.batch_interval(), Duration::from_millis(100));
    }

    #[test]
    fn switches_to_batched() {
        let mut aq = AdaptiveQuality::new();

        for _ in 0..HYSTERESIS_COUNT {
            aq.update_rtt(Duration::from_millis(80));
        }
        assert_eq!(aq.current_tier(), QualityTier::Batched);
        assert_eq!(aq.batch_interval(), Duration::from_millis(33));
    }

    #[test]
    fn critical_tier_filters_topics() {
        let mut aq = AdaptiveQuality::new();

        // Force into Critical
        for _ in 0..HYSTERESIS_COUNT {
            aq.update_rtt(Duration::from_millis(300));
        }
        assert_eq!(aq.current_tier(), QualityTier::Critical);

        // Only critical topics allowed
        assert!(aq.should_send("session/messages"));
        assert!(aq.should_send("system/events"));
        assert!(!aq.should_send("files/changes"));
        assert!(!aq.should_send("tasks/updates"));
        assert!(!aq.should_send("agents/metrics"));
    }

    #[test]
    fn recovers_to_full_from_critical() {
        let mut aq = AdaptiveQuality::new();

        // Go to Critical
        for _ in 0..HYSTERESIS_COUNT {
            aq.update_rtt(Duration::from_millis(200));
        }
        assert_eq!(aq.current_tier(), QualityTier::Critical);

        // Recover to Full
        for _ in 0..HYSTERESIS_COUNT {
            aq.update_rtt(Duration::from_millis(10));
        }
        assert_eq!(aq.current_tier(), QualityTier::Full);
    }

    #[test]
    fn interrupted_hysteresis_resets() {
        let mut aq = AdaptiveQuality::new();

        // Two Critical samples, then one Full — resets counter
        aq.update_rtt(Duration::from_millis(200));
        aq.update_rtt(Duration::from_millis(200));
        aq.update_rtt(Duration::from_millis(10)); // interrupt
        assert_eq!(aq.current_tier(), QualityTier::Full);

        // Need fresh 3 consecutive to switch
        aq.update_rtt(Duration::from_millis(200));
        aq.update_rtt(Duration::from_millis(200));
        assert_eq!(aq.current_tier(), QualityTier::Full); // still 2, not 3
    }

    #[test]
    fn average_rtt_calculation() {
        let mut aq = AdaptiveQuality::new();
        assert!(aq.average_rtt().is_none());

        aq.update_rtt(Duration::from_millis(10));
        aq.update_rtt(Duration::from_millis(30));
        let avg = aq.average_rtt().unwrap();
        assert_eq!(avg, Duration::from_millis(20));
    }

    #[test]
    fn sliding_window_evicts_old() {
        let mut aq = AdaptiveQuality::new();

        // Fill window with 10 samples
        for _ in 0..WINDOW_SIZE {
            aq.update_rtt(Duration::from_millis(10));
        }
        assert_eq!(aq.sample_count(), WINDOW_SIZE);

        // Adding more should keep window at max size
        aq.update_rtt(Duration::from_millis(10));
        assert_eq!(aq.sample_count(), WINDOW_SIZE);
    }

    #[test]
    fn quality_tier_from_rtt_boundaries() {
        assert_eq!(
            QualityTier::from_rtt(Duration::from_millis(0)),
            QualityTier::Full
        );
        assert_eq!(
            QualityTier::from_rtt(Duration::from_millis(49)),
            QualityTier::Full
        );
        assert_eq!(
            QualityTier::from_rtt(Duration::from_millis(50)),
            QualityTier::Batched
        );
        assert_eq!(
            QualityTier::from_rtt(Duration::from_millis(150)),
            QualityTier::Batched
        );
        assert_eq!(
            QualityTier::from_rtt(Duration::from_millis(151)),
            QualityTier::Critical
        );
    }

    #[test]
    fn mixed_tier_hysteresis() {
        let mut aq = AdaptiveQuality::new();

        // Two Critical, then two Batched — neither should trigger
        aq.update_rtt(Duration::from_millis(200));
        aq.update_rtt(Duration::from_millis(200));
        aq.update_rtt(Duration::from_millis(80));
        aq.update_rtt(Duration::from_millis(80));
        assert_eq!(aq.current_tier(), QualityTier::Full); // still Full, mixed signals

        // Three consecutive Batched now
        aq.update_rtt(Duration::from_millis(80));
        assert_eq!(aq.current_tier(), QualityTier::Batched);
    }

    #[test]
    fn critical_events_never_dropped_during_tier_transition() {
        let mut aq = AdaptiveQuality::new();

        // Transition Full → Critical: critical topics must ALWAYS pass
        for i in 0..HYSTERESIS_COUNT + 2 {
            aq.update_rtt(Duration::from_millis(200));
            assert!(
                aq.should_send("session/messages"),
                "session/messages dropped at sample {i}"
            );
            assert!(
                aq.should_send("system/events"),
                "system/events dropped at sample {i}"
            );
        }
        assert_eq!(aq.current_tier(), QualityTier::Critical);

        // Transition Critical → Full: critical topics still pass during recovery
        for i in 0..HYSTERESIS_COUNT + 2 {
            aq.update_rtt(Duration::from_millis(10));
            assert!(
                aq.should_send("session/messages"),
                "session/messages dropped during recovery at sample {i}"
            );
            assert!(
                aq.should_send("system/events"),
                "system/events dropped during recovery at sample {i}"
            );
        }
        assert_eq!(aq.current_tier(), QualityTier::Full);
    }

    #[test]
    fn non_critical_filtered_only_after_tier_switch() {
        let mut aq = AdaptiveQuality::new();

        // Full tier: files/changes passes
        assert!(aq.should_send("files/changes"));

        // During hysteresis (2 Critical samples, still in Full)
        aq.update_rtt(Duration::from_millis(200));
        aq.update_rtt(Duration::from_millis(200));
        assert_eq!(aq.current_tier(), QualityTier::Full);
        assert!(aq.should_send("files/changes"));

        // Third sample → switches to Critical
        aq.update_rtt(Duration::from_millis(200));
        assert_eq!(aq.current_tier(), QualityTier::Critical);
        assert!(!aq.should_send("files/changes"));

        // Recovery: 2 Full samples, still Critical
        aq.update_rtt(Duration::from_millis(10));
        aq.update_rtt(Duration::from_millis(10));
        assert_eq!(aq.current_tier(), QualityTier::Critical);
        assert!(!aq.should_send("files/changes"));

        // Third Full sample → switches back to Full
        aq.update_rtt(Duration::from_millis(10));
        assert_eq!(aq.current_tier(), QualityTier::Full);
        assert!(aq.should_send("files/changes"));
    }
}
