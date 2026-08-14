//
//  ViewController.swift
//  Shared (App)
//
//  Created by Sunny Yu on 13/8/2026.
//

import Foundation
import WebKit

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
import SafariServices
typealias PlatformViewController = NSViewController
#endif

let extensionBundleIdentifier = "com.sunny.dual-subtitle-companion.extension"
let allowedExternalURLs: Set<String> = [
    "https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/blob/main/PRIVACY_POLICY.md",
    "https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/issues",
    "https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/blob/main/THIRD_PARTY_NOTICES.md"
]

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
#if os(iOS)
        webView.evaluateJavaScript("show('ios')")
#elseif os(macOS)
        webView.evaluateJavaScript("show('mac')")

        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { [weak self] state, error in
            if let error {
                self?.displayError("Unable to read the Safari extension status: \(error.localizedDescription)")
                return
            }
            guard let state else {
                self?.displayError("Safari did not return an extension status. Check that the app and extension are installed from the same build.")
                return
            }

            DispatchQueue.main.async {
                if #available(macOS 13, *) {
                    self?.webView.evaluateJavaScript("show('mac', \(state.isEnabled), true)")
                } else {
                    self?.webView.evaluateJavaScript("show('mac', \(state.isEnabled), false)")
                }
            }
        }
#endif
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            let body = message.body as? [String: Any],
            let action = body["action"] as? String
        else {
            displayError("The app received an invalid action from its local help page.")
            return
        }

        switch action {
        case "open-preferences":
#if os(macOS)
            SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { [weak self] error in
                if let error {
                    self?.displayError("Unable to open Safari Settings: \(error.localizedDescription)")
                    return
                }

                DispatchQueue.main.async {
                    NSApp.terminate(self)
                }
            }
#else
            displayError("Open Safari Settings manually to manage this extension.")
#endif
        case "open-url":
            guard let value = body["url"] as? String else {
                displayError("The requested link is invalid.")
                return
            }
            openExternalURL(value)
        default:
            displayError("The requested action is not supported.")
        }
    }

    private func openExternalURL(_ value: String) {
        guard allowedExternalURLs.contains(value), let url = URL(string: value) else {
            displayError("For your security, the app blocked an unapproved external link.")
            return
        }

#if os(iOS)
        UIApplication.shared.open(url, options: [:]) { [weak self] opened in
            if !opened {
                self?.displayError("Unable to open the requested link. Check your network connection and browser settings.")
            }
        }
#elseif os(macOS)
        if !NSWorkspace.shared.open(url) {
            displayError("Unable to open the requested link. Check your network connection and default browser settings.")
        }
#endif
    }

    private func displayError(_ message: String) {
        let literal = javascriptStringLiteral(message)
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript("showError(\(literal))")
        }
    }

    private func javascriptStringLiteral(_ value: String) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed),
            let literal = String(data: data, encoding: .utf8)
        else {
            return "\"An unexpected error occurred.\""
        }
        return literal
    }
}
