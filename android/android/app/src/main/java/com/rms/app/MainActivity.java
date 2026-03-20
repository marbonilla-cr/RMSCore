package com.rms.app;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.BridgeActivity;
import com.rms.printtcp.PrintTcpPlugin;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(PrintTcpPlugin.class);
    super.onCreate(savedInstanceState);

    WebView webView = getBridge().getWebView();
    // Prevent the Android status bar from covering web content by adding the status bar height as top padding.
    webView.setOnApplyWindowInsetsListener((v, insets) -> {
      int statusBarHeight;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        statusBarHeight = insets.getInsets(WindowInsets.Type.statusBars()).top;
      } else {
        statusBarHeight = insets.getSystemWindowInsetTop();
      }

      v.setPadding(v.getPaddingLeft(), statusBarHeight, v.getPaddingRight(), v.getPaddingBottom());
      return insets;
    });
    webView.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(android.webkit.WebView view, String url) {
        if (url != null && url.contains("rmscore.app")) {
          view.loadUrl(url);
          return true;
        }
        return false;
      }

      @Override
      public boolean shouldOverrideUrlLoading(android.webkit.WebView view,
          android.webkit.WebResourceRequest request) {
        String url = request.getUrl().toString();
        if (url != null && url.contains("rmscore.app")) {
          view.loadUrl(url);
          return true;
        }
        return false;
      }
    });

    // Ensure the insets listener runs at least once.
    webView.requestApplyInsets();
  }
}