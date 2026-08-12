package com.sng.logistics.scanner;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

final class ServerUrl {
    private static final String SCANNER_PATH = "/scanner/pda";

    private ServerUrl() {}

    static String normalize(String raw, boolean allowPrivateHttp) {
        if (raw == null || raw.trim().isEmpty()) {
            throw new IllegalArgumentException("กรุณากรอก Server URL");
        }

        String candidate = raw.trim();
        if (!candidate.matches("^[A-Za-z][A-Za-z0-9+.-]*://.*$")) {
            candidate = "https://" + candidate;
        }

        final URI uri;
        try {
            uri = new URI(candidate);
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("รูปแบบ Server URL ไม่ถูกต้อง");
        }

        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        if (!("https".equals(scheme) || "http".equals(scheme)) || host.isEmpty()) {
            throw new IllegalArgumentException("Server URL ต้องเป็น http:// หรือ https:// เท่านั้น");
        }
        if (uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw new IllegalArgumentException("Server URL ห้ามมีรหัสผ่าน query หรือ fragment");
        }
        if ("http".equals(scheme) && (!allowPrivateHttp || !isPrivateHost(host))) {
            throw new IllegalArgumentException("การใช้งานผ่าน Net SIM ต้องใช้ HTTPS");
        }

        String path = uri.getPath() == null ? "" : uri.getPath().trim();
        while (path.endsWith("/") && path.length() > 1) path = path.substring(0, path.length() - 1);
        if (path.endsWith(SCANNER_PATH)) path = path.substring(0, path.length() - SCANNER_PATH.length());
        if ("/".equals(path)) path = "";

        try {
            return new URI(scheme, null, host, uri.getPort(), path, null, null).toASCIIString();
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("รูปแบบ Server URL ไม่ถูกต้อง");
        }
    }

    static String scannerUrl(String normalizedBaseUrl) {
        return normalizedBaseUrl + SCANNER_PATH;
    }

    static boolean isSameOrigin(String baseUrl, String destination) {
        try {
            URI base = new URI(baseUrl);
            URI target = new URI(destination);
            return equalsIgnoreCase(base.getScheme(), target.getScheme())
                && equalsIgnoreCase(base.getHost(), target.getHost())
                && effectivePort(base) == effectivePort(target);
        } catch (URISyntaxException error) {
            return false;
        }
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private static boolean equalsIgnoreCase(String left, String right) {
        return left != null && right != null && left.equalsIgnoreCase(right);
    }

    private static boolean isPrivateHost(String host) {
        if ("localhost".equals(host) || "127.0.0.1".equals(host) || "::1".equals(host)) return true;
        if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
        if (!host.startsWith("172.")) return false;
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        try {
            int second = Integer.parseInt(parts[1]);
            return second >= 16 && second <= 31;
        } catch (NumberFormatException error) {
            return false;
        }
    }
}
