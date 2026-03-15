Feature: Toast Notifications
  As a user
  I want to see feedback messages for my actions
  So that I know whether operations succeeded or failed

  Background:
    Given the app is loaded

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Success toast on trip save
    Given I have an active trip
    When I end and save the trip
    Then I see a green success toast notification
    And the toast auto-dismisses after 3 seconds

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Error toast on failed operation
    Given an operation fails
    Then I see a red error toast notification
    And the toast includes a close button

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Maximum 3 toasts visible at once
    When 5 toast notifications are triggered rapidly
    Then only 3 toasts are visible at a time
    And older toasts are dismissed as new ones appear

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Toast variants
    Then toast notifications support the following variants:
      | Variant | Color  |
      | success | green  |
      | error   | red    |
      | info    | blue   |
      | warning | yellow |

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Dismiss toast manually
    Given a toast notification is visible
    When I tap the close button on the toast
    Then the toast is dismissed immediately
