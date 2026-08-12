package com.sng.logistics.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ServerUrlTest {
    @Test
    public void normalizesPublicHttpsAndScannerPath() {
        assertEquals("https://sng-logistics.co", ServerUrl.normalize("sng-logistics.co/scanner/pda", false));
        assertEquals("https://sng-logistics.co/scanner/pda", ServerUrl.scannerUrl("https://sng-logistics.co"));
    }

    @Test
    public void permitsPrivateHttpOnlyForDebugAcceptance() {
        assertEquals("http://192.168.100.88:3500", ServerUrl.normalize("http://192.168.100.88:3500/", true));
        assertThrows(IllegalArgumentException.class, () -> ServerUrl.normalize("http://192.168.100.88:3500", false));
        assertThrows(IllegalArgumentException.class, () -> ServerUrl.normalize("http://example.com", true));
    }

    @Test
    public void rejectsCredentialsAndUnsafeSchemes() {
        assertThrows(IllegalArgumentException.class, () -> ServerUrl.normalize("https://user:pass@example.com", false));
        assertThrows(IllegalArgumentException.class, () -> ServerUrl.normalize("javascript:alert(1)", false));
    }

    @Test
    public void sameOriginAllowsLoginRedirectButBlocksExternalHosts() {
        assertTrue(ServerUrl.isSameOrigin("https://sng-logistics.co", "https://sng-logistics.co/login"));
        assertFalse(ServerUrl.isSameOrigin("https://sng-logistics.co", "https://evil.example/scanner/pda"));
        assertFalse(ServerUrl.isSameOrigin("https://sng-logistics.co", "http://sng-logistics.co/scanner/pda"));
    }
}
