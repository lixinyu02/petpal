package com.petpal.app;

import java.io.IOException;
import org.junit.Test;
import static org.junit.Assert.*;

public class LoginVaultGateTest {
    @Test public void newestRevisionRejectsOldWork()throws Exception {LoginVaultGate gate=new LoginVaultGate();long owner=gate.claimOwner(),first=gate.reserve(false),second=gate.reserve(false);assertThrows(IOException.class,()->gate.check(first,owner));gate.check(second,owner);gate.committed(second,owner);}
    @Test public void newActivityCancelsOldUncommittedWorkWithoutChangingClearRevision()throws Exception {LoginVaultGate gate=new LoginVaultGate();long oldOwner=gate.claimOwner(),revision=gate.reserve(false),owner=gate.claimOwner();assertThrows(IOException.class,()->gate.committed(revision,oldOwner));gate.cancelWrite(revision,oldOwner);gate.check(revision,owner);long clear=gate.reserve(true);gate.claimOwner();gate.check(clear,0);gate.committed(clear,0);assertFalse(gate.clearing());}
    @Test public void destructionCancelsOnlyItsOwnPendingWrite()throws Exception {LoginVaultGate gate=new LoginVaultGate();long owner=gate.claimOwner(),old=gate.reserve(false);gate.cancelWrite(old,owner);assertThrows(IOException.class,()->gate.check(old,owner));long next=gate.reserve(false);gate.cancelWrite(old,owner);gate.check(next,owner);}
    @Test public void destructionDoesNotUndoAlreadyCommittedLogin()throws Exception {LoginVaultGate gate=new LoginVaultGate();long owner=gate.claimOwner(),revision=gate.reserve(false);gate.committed(revision,owner);gate.cancelWrite(revision,owner);gate.check(revision,owner);}
    @Test public void pendingClearSuppressesRestoreAndSurvivesOldWriteCancellation()throws Exception {LoginVaultGate gate=new LoginVaultGate();long owner=gate.claimOwner(),old=gate.reserve(false),clear=gate.reserve(true);assertTrue(gate.clearing());gate.cancelWrite(old,owner);gate.check(clear,0);gate.committed(clear,0);assertFalse(gate.clearing());}
    @Test public void newExplicitLoginSupersedesOldClear()throws Exception {LoginVaultGate gate=new LoginVaultGate();gate.claimOwner();long clear=gate.reserve(true),write=gate.reserve(false);assertFalse(gate.clearing());assertThrows(IOException.class,()->gate.check(clear,0));gate.check(write,0);}
}
