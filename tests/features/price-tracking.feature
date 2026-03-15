Feature: Price Tracking and History
  As a price-conscious shopper
  I want to track item prices over time
  So that I can find the best deals and monitor price changes

  Background:
    Given the app is loaded

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Price history is recorded when item is added to trip
    Given I have an active trip at "Trader Joe's"
    And I have an item "Bananas" at "$0.69"
    When I add "Bananas" to the trip
    Then a price history entry is created
    And the entry records the item, store, price, and timestamp

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View price history report for an item
    Given "Bananas" has been purchased at the following prices:
      | Store          | Price | Date       |
      | Trader Joe's   | $0.69 | 2025-01-15 |
      | Costco         | $0.59 | 2025-01-20 |
      | Trader Joe's   | $0.79 | 2025-02-01 |
    When I navigate to the Price History Report for "Bananas"
    Then I see a line chart showing price trends over time
    And I see the lowest price as "$0.59"
    And I see the highest price as "$0.79"
    And I see the average price
    And I see the current (most recent) price as "$0.79"

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Filter price history by store
    Given "Bananas" has price history at "Trader Joe's" and "Costco"
    When I view the Price History Report for "Bananas"
    And I filter by store "Trader Joe's"
    Then I only see price entries from "Trader Joe's"
    And the chart updates to show only "Trader Joe's" data

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View price chart on item detail page
    Given "Bananas" has price history across multiple trips
    When I navigate to the Item Detail page for "Bananas"
    Then I see a compact price chart
    And I see a link to the full Price History Report

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Price calculation for each-type items
    Given an item "Eggs" with unit type "each" at "$5.99"
    When I add "Eggs" with quantity 2
    Then the line total is calculated as "$11.98"

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Price calculation for per-pound items
    Given an item "Chicken Breast" with unit type "per_lb" at "$6.99"
    When I add "Chicken Breast" with weight 2.50 lbs
    Then the line total is calculated as "$17.48"
