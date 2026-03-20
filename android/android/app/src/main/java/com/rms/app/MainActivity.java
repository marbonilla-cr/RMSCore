package com.rms.app;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.rms.printtcp.PrintTcpPlugin;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(PrintTcpPlugin.class);
    super.onCreate(savedInstanceState);

    // Aplicar padding top igual al alto de la status bar
    ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content), (v, insets) -> {
      int statusBarHeight = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top;
      v.setPadding(0, statusBarHeight, 0, 0);
      return insets;
    });

    WebView webView = getBridge().getWebView();
    webView.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, String url) {
        if (url != null && url.contains("rmscore.app")) {
          view.loadUrl(url);
          return true;
        }
        return false;
      }

      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        String url = request.getUrl().toString();
        if (url.contains("rmscore.app")) {
          view.loadUrl(url);
          return true;
        }
        return false;
      }
    });
  }
}