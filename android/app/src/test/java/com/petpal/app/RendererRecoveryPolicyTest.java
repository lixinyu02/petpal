package com.petpal.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class RendererRecoveryPolicyTest {
    @Test public void repeatedExitsStopAutomaticRecovery() { RendererRecoveryPolicy policy=new RendererRecoveryPolicy();assertTrue(policy.automatic(100));assertTrue(policy.automatic(200));for(int n=0;n<20;n++)assertFalse(policy.automatic(300+n)); }
    @Test public void stableWindowRecoversTheBudget() { RendererRecoveryPolicy policy=new RendererRecoveryPolicy();policy.automatic(0);policy.automatic(100);assertFalse(policy.automatic(200));assertTrue(policy.automatic(60_000));assertFalse(policy.automatic(60_001));assertTrue(policy.automatic(60_100)); }
    @Test public void manualRetryIsAnExplicitNewBudget() { RendererRecoveryPolicy policy=new RendererRecoveryPolicy();policy.automatic(0);policy.automatic(1);assertFalse(policy.automatic(2));policy.retryByUser();assertTrue(policy.automatic(3));assertTrue(policy.automatic(4));assertFalse(policy.automatic(5)); }
    @Test public void elapsedClockResetDoesNotPermanentlyDisableRecovery() { RendererRecoveryPolicy policy=new RendererRecoveryPolicy();policy.automatic(1000);policy.automatic(2000);assertTrue(policy.automatic(10));assertTrue(policy.automatic(20));assertFalse(policy.automatic(30)); }
}
