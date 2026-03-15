Feature: Analytics and Reports
  As a grocery shopper
  I want to view spending analytics and reports
  So that I can understand my shopping habits and optimize spending

  Background:
    Given the app is loaded
    And I have completed multiple trips with items

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View reports hub
    When I navigate to the Reports page
    Then I see 4 report categories:
      | Report           | Description                              |
      | Spending         | Total spending over time                 |
      | Most Bought      | Most frequently purchased items          |
      | Price History    | Track price changes for specific items   |
      | Trip Accuracy    | Compare scanned vs receipt totals        |

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View spending report
    Given I have trips totaling "$500.00" over the last 30 days
    When I navigate to the Spending Report
    Then I see the total spending as "$500.00"
    And I see the average per trip
    And I see the total trip count
    And I see a bar chart showing spending per week

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Filter spending report by date range
    When I navigate to the Spending Report
    And I select the date range "Last 30 Days"
    Then the report updates to show only trips within the last 30 days
    And the chart reflects the filtered data

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Spending report groups by month for longer periods
    When I navigate to the Spending Report
    And I select a date range spanning more than 60 days
    Then the bar chart groups spending per month instead of per week

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View most bought items report
    Given I have purchased "Bananas" 15 times and "Milk" 10 times
    When I navigate to the Most Bought Report
    Then I see items ranked by purchase frequency
    And "Bananas" is ranked #1
    And "Milk" is ranked #2
    And the top 3 items have gold rank indicators

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Most bought report links to price history
    When I navigate to the Most Bought Report
    And I tap on an item row
    Then I am navigated to the Price History Report for that item

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View trip accuracy report
    Given I have trips with the following data:
      | Scanned | Actual  | Difference |
      | $24.50  | $25.00  | $0.50      |
      | $30.00  | $28.50  | -$1.50     |
      | $50.00  | $50.00  | $0.00      |
    When I navigate to the Trip Accuracy Report
    Then I see the average difference
    And I see the overall accuracy percentage
    And I see a bar chart showing difference per trip
    And trips over scanned show red bars
    And trips under scanned show green bars
    And exact matches show gray bars

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Empty report state
    Given I have no completed trips
    When I navigate to the Spending Report
    Then I see an empty state message
    And the message suggests starting a trip to see data
