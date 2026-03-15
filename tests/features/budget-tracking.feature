Feature: Budget Tracking
  As a grocery shopper
  I want to set a budget for my shopping trip
  So that I can track my spending against my planned budget

  Background:
    Given the app is loaded
    And a store "Trader Joe's" exists

  # Commit: Add trip budget tracking with remaining balance display
  Scenario: Set a budget when starting a trip
    When I navigate to the New Trip page
    And I select the store "Trader Joe's"
    And I enter a budget of "$75.00"
    And I tap "Start Shopping"
    Then the active trip should have a budget of "$75.00"
    And I should see the budget displayed on the Active Trip page

  # Commit: Add trip budget tracking with remaining balance display
  Scenario: Start a trip without a budget
    When I navigate to the New Trip page
    And I select the store "Trader Joe's"
    And I leave the budget field empty
    And I tap "Start Shopping"
    Then the active trip should have no budget set
    And the budget display should not be shown

  # Commit: Add trip budget tracking with remaining balance display
  Scenario: View remaining balance during trip
    Given I have an active trip with a budget of "$75.00"
    And the scanned subtotal is "$30.00"
    When I view the Active Trip page
    Then I should see the remaining balance of "$45.00"
    And I should see the budget of "$75.00"
    And I should see the current subtotal of "$30.00"

  # Commit: Add trip budget tracking with remaining balance display
  Scenario: Edit budget during an active trip
    Given I have an active trip with a budget of "$75.00"
    When I tap to edit the budget
    Then a budget editing modal should appear
    When I change the budget to "$100.00"
    And I tap "Save"
    Then the budget should be updated to "$100.00"
    And the remaining balance should be recalculated

  # Commit: Add trip budget tracking with remaining balance display
  Scenario: Remove budget during an active trip
    Given I have an active trip with a budget of "$75.00"
    When I tap to edit the budget
    And I clear the budget field
    And I tap "Save"
    Then the budget should be removed
    And the budget display should no longer be shown
