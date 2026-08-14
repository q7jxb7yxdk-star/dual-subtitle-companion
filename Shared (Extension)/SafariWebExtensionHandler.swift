//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//
//  Created by Sunny Yu on 13/8/2026.
//

import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
