//
//  ViewController.swift
//  Shared (App)
//
//  Created by Sunny Yu on 13/8/2026.
//

import Foundation
import WebKit
import Cocoa
import SafariServices

let extensionBundleIdentifier = "com.sunny.dual-subtitle-companion.extension"
let allowedExternalURLs: Set<String> = [
    "https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/blob/main/PRIVACY_POLICY.md",
    "https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/issues",
    "https://github.com/q7jxb7yxdk-star/dual-subtitle-companion/blob/main/THIRD_PARTY_NOTICES.md"
]

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
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
                self?.webView.evaluateJavaScript("show(\(state.isEnabled))")
            }
        }
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
            SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { [weak self] error in
                if let error {
                    self?.displayError("Unable to open Safari Settings: \(error.localizedDescription)")
                    return
                }

                DispatchQueue.main.async {
                    NSApp.terminate(self)
                }
            }
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

        if !NSWorkspace.shared.open(url) {
            displayError("Unable to open the requested link. Check your network connection and default browser settings.")
        }
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
