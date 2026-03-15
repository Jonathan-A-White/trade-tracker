Feature: Trip Management
  As a grocery shopper
  I want to manage shopping trips
  So that I can track my spending at different stores

  Background:
    Given the app is loaded
    And a store "Trader Joe's" exists

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Start a new shopping trip
    Given I am on the Home page
    When I tap "Start Trip"
    And I select the store "Trader Joe's"
    And I tap "Start Shopping"
    Then a new trip should be created with status "active"
    And I should be navigated to the Active Trip page
    And I should see the store name "Trader Joe's"

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Start a new trip with an active trip already in progress
    Given I have an active trip at "Trader Joe's"
    And I am on the Home page
    When I tap "Start Trip"
    And I select the store "Trader Joe's"
    And I tap "Start Shopping"
    Then I should see a confirmation dialog asking to end the current trip
    When I confirm ending the current trip
    Then the previous trip should be ended
    And a new active trip should be created

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: View active trip with elapsed time
    Given I have an active trip at "Trader Joe's"
    When I navigate to the Active Trip page
    Then I should see the elapsed time updating in real-time
    And I should see the store name "Trader Joe's"
    And I should see the scanned subtotal

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: End a shopping trip with receipt total
    Given I have an active trip at "Trader Joe's"
    And the scanned subtotal is "$25.50"
    When I tap "End Trip"
    And I enter a receipt total of "$26.00"
    And I tap "Save Trip"
    Then the trip status should change to "completed"
    And the actual total should be "$26.00"
    And the difference should show "$0.50"

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: End a trip without entering receipt total
    Given I have an active trip at "Trader Joe's"
    When I tap "End Trip"
    And I tap "Save Trip" without entering a receipt total
    Then the trip should be saved with the scanned subtotal only
    And the trip status should change to "completed"

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: End trip shows color-coded difference feedback
    Given I have an active trip with scanned subtotal "$25.00"
    When I tap "End Trip"
    And I enter a receipt total of "$25.75"
    Then the difference display should be green indicating a great match
    When I clear and enter a receipt total of "$28.00"
    Then the difference display should be yellow indicating slight variance
    When I clear and enter a receipt total of "$32.00"
    Then the difference display should be red indicating a large discrepancy

  # Commit: Fix end trip saving hang caused by Dexie transaction conflict
  Scenario: End trip saves without hanging
    Given I have an active trip at "Trader Joe's"
    And I have added items to the trip
    When I tap "End Trip"
    And I enter a receipt total of "$30.00"
    And I tap "Save Trip"
    Then the trip should save successfully without freezing
    And I should be navigated away from the End Trip page

  # Commit: Fix View All 404 and add trip deletion
  Scenario: Delete a completed trip
    Given I have a completed trip at "Trader Joe's" on "2025-01-15"
    When I navigate to the Trip Detail page for that trip
    And I tap the delete button
    Then I should see a confirmation dialog
    When I confirm the deletion
    Then the trip should be removed from the database
    And I should be navigated to the Trip History page

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: View trip history
    Given I have completed trips at "Trader Joe's" and "Whole Foods"
    When I navigate to the Trip History page
    Then I should see a list of all completed trips
    And each trip card should show the store name, date, and total

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Filter trip history by store
    Given I have completed trips at "Trader Joe's" and "Whole Foods"
    When I navigate to the Trip History page
    And I filter by store "Trader Joe's"
    Then I should only see trips from "Trader Joe's"

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Filter trip history by date range
    Given I have trips from the last 90 days
    When I navigate to the Trip History page
    And I select the "Last 7 Days" date filter
    Then I should only see trips from the last 7 days

  # Commit: Make trip search card sticky at top of Trip History page
  Scenario: Trip history search card stays visible while scrolling
    Given I have many completed trips
    When I navigate to the Trip History page
    And I scroll down through the trip list
    Then the search and filter card should remain sticky at the top

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: View trip detail
    Given I have a completed trip at "Trader Joe's"
    When I navigate to the Trip Detail page for that trip
    Then I should see the trip date and time
    And I should see the scanned subtotal and actual total
    And I should see the difference with color coding
    And I should see the list of items with prices and quantities

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Edit a completed trip
    Given I have a completed trip with item "Bananas" at "$0.29"
    When I navigate to the Trip Edit page
    And I change the price of "Bananas" to "$0.35"
    And I tap "Save Changes"
    Then the item price should be updated to "$0.35"
    And the trip subtotal should be recalculated
