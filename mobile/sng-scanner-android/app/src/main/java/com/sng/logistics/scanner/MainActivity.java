package com.sng.logistics.scanner;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Arrays;

public final class MainActivity extends Activity {
    private static final String PREFS = "sng_scanner_preferences";
    private static final String PREF_SERVER_URL = "server_url";
    private static final int CAMERA_PERMISSION_REQUEST = 2107;

    private SharedPreferences preferences;
    private WebView webView;
    private TextView networkStatus;
    private LinearLayout errorPanel;
    private TextView errorMessage;
    private String baseUrl = "";
    private boolean settingsDialogVisible = false;
    private PermissionRequest pendingCameraRequest;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        baseUrl = preferences.getString(PREF_SERVER_URL, BuildConfig.DEFAULT_SERVER_URL);
        buildUi();
        configureWebView();
        registerNetworkCallback();
        updateNetworkStatus();

        if (baseUrl == null || baseUrl.isEmpty()) {
            showServerDialog(true);
        } else {
            loadScanner();
        }
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(15, 23, 42));

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(12), dp(5), dp(6), dp(5));
        header.setBackgroundColor(Color.rgb(2, 6, 23));
        root.addView(header, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        LinearLayout titleBlock = new LinearLayout(this);
        titleBlock.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        header.addView(titleBlock, titleParams);

        TextView title = new TextView(this);
        title.setText(R.string.scanner_title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(16);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        titleBlock.addView(title);

        networkStatus = new TextView(this);
        networkStatus.setText("● กำลังตรวจเครือข่าย");
        networkStatus.setTextColor(Color.rgb(148, 163, 184));
        networkStatus.setTextSize(11);
        titleBlock.addView(networkStatus);

        Button refreshButton = headerButton("↻", "โหลดหน้าใหม่");
        refreshButton.setOnClickListener(view -> {
            if (webView.getUrl() == null) loadScanner(); else webView.reload();
        });
        header.addView(refreshButton);

        Button settingsButton = headerButton("⚙", "ตั้งค่า Server URL");
        settingsButton.setOnClickListener(view -> showServerDialog(false));
        header.addView(settingsButton);

        FrameLayout content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(15, 23, 42));
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        content.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28), dp(28), dp(28), dp(28));
        errorPanel.setBackgroundColor(Color.rgb(15, 23, 42));
        errorPanel.setVisibility(View.GONE);
        content.addView(errorPanel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        TextView errorIcon = new TextView(this);
        errorIcon.setText("📡");
        errorIcon.setTextSize(48);
        errorIcon.setGravity(Gravity.CENTER);
        errorPanel.addView(errorIcon);

        errorMessage = new TextView(this);
        errorMessage.setTextColor(Color.WHITE);
        errorMessage.setTextSize(16);
        errorMessage.setGravity(Gravity.CENTER);
        errorMessage.setPadding(0, dp(12), 0, dp(18));
        errorPanel.addView(errorMessage);

        Button retryButton = actionButton("ลองเชื่อมต่ออีกครั้ง");
        retryButton.setOnClickListener(view -> loadScanner());
        errorPanel.addView(retryButton);

        Button errorSettingsButton = actionButton("เปลี่ยน Server URL");
        errorSettingsButton.setOnClickListener(view -> showServerDialog(false));
        LinearLayout.LayoutParams errorButtonParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        errorButtonParams.topMargin = dp(10);
        errorPanel.addView(errorSettingsButton, errorButtonParams);

        setContentView(root);
    }

    private Button headerButton(String text, String description) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(20);
        button.setTextColor(Color.WHITE);
        button.setContentDescription(description);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(dp(12), 0, dp(12), 0);
        button.setBackgroundColor(Color.TRANSPARENT);
        return button;
    }

    private Button actionButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextColor(Color.rgb(15, 23, 42));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.rgb(251, 191, 36));
        background.setCornerRadius(dp(10));
        button.setBackground(background);
        return button;
    }

    @SuppressLint("SetJavaScriptEnabled")
    @SuppressWarnings("deprecation")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " SNGScanner/" + BuildConfig.VERSION_NAME + " iT78");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                networkStatus.setText("● กำลังเชื่อมต่อ");
                networkStatus.setTextColor(Color.rgb(251, 191, 36));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                hideError();
                updateNetworkStatus();
                view.evaluateJavascript(
                    "(function(){var i=document.getElementById('barcodeInput');" +
                    "if(i){i.setAttribute('inputmode','none');i.focus();}" +
                    "document.addEventListener('visibilitychange',function(){if(!document.hidden&&i)i.focus();});})();",
                    null
                );
                view.requestFocus();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError("เชื่อมต่อระบบ SNG ไม่ได้\nตรวจ Net SIM หรือ Server URL แล้วลองอีกครั้ง");
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) {
                    showError("เซิร์ฟเวอร์ตอบกลับ HTTP " + response.getStatusCode() + "\nตรวจว่า deploy หน้า /scanner/pda แล้ว");
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                showError("ใบรับรอง HTTPS ไม่ปลอดภัยหรือหมดอายุ\nแอปยกเลิกการเชื่อมต่อเพื่อป้องกันข้อมูลรั่วไหล");
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingCameraRequest == request) pendingCameraRequest = null;
            }
        });
    }

    private boolean handleNavigation(Uri destination) {
        String url = destination.toString();
        if ("about".equalsIgnoreCase(destination.getScheme()) || ServerUrl.isSameOrigin(baseUrl, url)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, destination));
        } catch (Exception error) {
            Toast.makeText(this, "ไม่พบแอปสำหรับเปิดลิงก์นี้", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        boolean asksForCamera = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
        if (!asksForCamera || !ServerUrl.isSameOrigin(baseUrl, request.getOrigin().toString())) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            return;
        }
        pendingCameraRequest = request;
        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_PERMISSION_REQUEST || pendingCameraRequest == null) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            pendingCameraRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            pendingCameraRequest.deny();
        }
        pendingCameraRequest = null;
    }

    private void loadScanner() {
        if (baseUrl == null || baseUrl.isEmpty()) {
            showServerDialog(true);
            return;
        }
        if (!isOnline()) {
            showError(networkProblemMessage());
            updateNetworkStatus();
            return;
        }
        hideError();
        webView.loadUrl(ServerUrl.scannerUrl(baseUrl));
    }

    private void showServerDialog(boolean required) {
        if (settingsDialogVisible) return;
        settingsDialogVisible = true;

        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(22), dp(8), dp(22), 0);

        TextView help = new TextView(this);
        help.setText("นอกสถานที่ใช้โดเมน HTTPS ผ่าน Net SIM\nระบบจริง: https://sng-logistics.co\n\nLAN ทดสอบ: http://192.168.100.88:3500");
        help.setTextSize(14);
        help.setTextColor(Color.rgb(51, 65, 85));
        form.addView(help);

        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("https://your-domain.com");
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(baseUrl);
        input.setSelectAllOnFocus(true);
        form.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView validation = new TextView(this);
        validation.setTextColor(Color.rgb(220, 38, 38));
        validation.setTextSize(12);
        validation.setPadding(0, dp(4), 0, 0);
        form.addView(validation);

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("ตั้งค่า SNG Server")
            .setView(form)
            .setPositiveButton("บันทึกและเชื่อมต่อ", null)
            .setNegativeButton(required ? "ปิดแอป" : "ยกเลิก", null)
            .setNeutralButton("เปิดการตั้งค่าเน็ต", null)
            .create();
        dialog.setCancelable(!required);
        dialog.setOnShowListener(ignored -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                try {
                    String normalized = ServerUrl.normalize(input.getText().toString(), BuildConfig.DEBUG);
                    boolean changed = !normalized.equals(baseUrl);
                    baseUrl = normalized;
                    preferences.edit().putString(PREF_SERVER_URL, normalized).apply();
                    if (changed) CookieManager.getInstance().removeAllCookies(null);
                    settingsDialogVisible = false;
                    dialog.dismiss();
                    loadScanner();
                } catch (IllegalArgumentException error) {
                    validation.setText(error.getMessage());
                }
            });
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener(view -> {
                settingsDialogVisible = false;
                dialog.dismiss();
                if (required) finish();
            });
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(view -> {
                try {
                    startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
                } catch (Exception error) {
                    Toast.makeText(this, "เปิดหน้าตั้งค่าเครือข่ายไม่ได้", Toast.LENGTH_SHORT).show();
                }
            });
        });
        dialog.setOnDismissListener(ignored -> settingsDialogVisible = false);
        dialog.show();
    }

    private void showError(String message) {
        errorMessage.setText(message);
        errorPanel.setVisibility(View.VISIBLE);
        webView.setVisibility(View.INVISIBLE);
    }

    private void hideError() {
        errorPanel.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
    }

    private boolean isOnline() {
        if (connectivityManager == null) connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        Network network = connectivityManager.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
        return capabilities != null
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }

    private String networkProblemMessage() {
        if (connectivityManager == null) connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        Network network = connectivityManager.getActiveNetwork();
        NetworkCapabilities capabilities = network == null ? null : connectivityManager.getNetworkCapabilities(network);
        if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
            return "Net SIM เชื่อมเครือข่ายแล้ว แต่ยังออกอินเทอร์เน็ตไม่ได้\nตรวจแพ็กเกจอินเทอร์เน็ต / APN แล้วลองอีกครั้ง";
        }
        return "ยังไม่มีอินเทอร์เน็ต\nเปิด Mobile Data / Wi-Fi แล้วลองอีกครั้ง";
    }

    private void updateNetworkStatus() {
        if (connectivityManager == null) connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        Network network = connectivityManager.getActiveNetwork();
        NetworkCapabilities capabilities = network == null ? null : connectivityManager.getNetworkCapabilities(network);
        if (capabilities == null || !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            networkStatus.setText(R.string.network_offline);
            networkStatus.setTextColor(Color.rgb(239, 68, 68));
        } else if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
            networkStatus.setText(capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
                ? R.string.network_cellular_no_internet
                : R.string.network_no_internet);
            networkStatus.setTextColor(Color.rgb(239, 68, 68));
        } else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
            networkStatus.setText(R.string.network_online_cellular);
            networkStatus.setTextColor(Color.rgb(34, 197, 94));
        } else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
            networkStatus.setText(R.string.network_online_wifi);
            networkStatus.setTextColor(Color.rgb(34, 197, 94));
        } else {
            networkStatus.setText(R.string.network_online);
            networkStatus.setTextColor(Color.rgb(34, 197, 94));
        }
    }

    private void registerNetworkCallback() {
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { runOnUiThread(() -> updateNetworkStatus()); }
            @Override public void onLost(Network network) { runOnUiThread(() -> updateNetworkStatus()); }
            @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
                runOnUiThread(() -> updateNetworkStatus());
            }
        };
        connectivityManager.registerDefaultNetworkCallback(networkCallback);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        boolean systemKey = keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_HOME
            || keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN
            || keyCode == KeyEvent.KEYCODE_POWER;
        if (!settingsDialogVisible && !systemKey && webView != null && webView.getVisibility() == View.VISIBLE) {
            webView.requestFocus();
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (networkCallback != null && connectivityManager != null) {
            try { connectivityManager.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) {}
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
