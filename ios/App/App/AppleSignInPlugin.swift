import AuthenticationServices
import Capacitor
import Foundation
import UIKit

/** Native Sign in with Apple bridge. The identity token is always verified by
 * the Worker before an account is created or a session is issued. */
@objc(AppleSignInPlugin)
public final class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin,
  ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  public let identifier = "AppleSignInPlugin"
  public let jsName = "AppleSignIn"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
  ]

  private var pendingCall: CAPPluginCall?

  @objc public func signIn(_ call: CAPPluginCall) {
    guard #available(iOS 13.0, *) else {
      call.reject("이 기기에서는 Apple 로그인을 지원하지 않습니다.")
      return
    }
    guard pendingCall == nil else {
      call.reject("Apple 로그인이 이미 진행 중입니다.")
      return
    }
    pendingCall = call
    let request = ASAuthorizationAppleIDProvider().createRequest()
    request.requestedScopes = [.fullName, .email]
    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = self
    controller.presentationContextProvider = self
    controller.performRequests()
  }

  @available(iOS 13.0, *)
  public func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization,
  ) {
    defer { pendingCall = nil }
    guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
          let tokenData = credential.identityToken,
          let idToken = String(data: tokenData, encoding: .utf8)
    else {
      pendingCall?.reject("Apple ID 토큰을 받지 못했습니다.")
      return
    }
    let authorizationCode = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
    let givenName = credential.fullName?.givenName ?? ""
    let familyName = credential.fullName?.familyName ?? ""
    pendingCall?.resolve([
      "idToken": idToken,
      "authorizationCode": authorizationCode ?? "",
      "displayName": "\(givenName) \(familyName)".trimmingCharacters(in: .whitespaces),
    ])
  }

  @available(iOS 13.0, *)
  public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    defer { pendingCall = nil }
    if let authorizationError = error as? ASAuthorizationError,
       authorizationError.code == .canceled {
      pendingCall?.reject("Apple 로그인을 취소했습니다.")
      return
    }
    pendingCall?.reject("Apple 로그인에 실패했습니다.", nil, error)
  }

  @available(iOS 13.0, *)
  public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    bridge?.viewController?.view.window ?? UIWindow()
  }
}
