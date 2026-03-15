Feature: Data Export and Import
  As a user
  I want to export and import my data
  So that I can back up my data and transfer it between devices

  Background:
    Given the app is loaded

  # From commit: Add export/import functionality for items and trips on Settings page
  Scenario: Export full backup as JSON
    Given I have stores, items, trips, and price history data
    When I navigate to the Settings page
    And I tap "Export Full Backup"
    Then a JSON file is downloaded
    And the filename includes a timestamp
    And the file contains all stores, items, trips, trip items, and price history

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Export items as CSV
    Given I have items in my library
    When I navigate to the Export page
    And I tap "Export Items CSV"
    Then a CSV file is downloaded
    And the CSV contains item headers and all item data

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Export trips as CSV
    Given I have completed trips with items
    When I navigate to the Export page
    And I tap "Export Trips CSV"
    Then a CSV file is downloaded
    And the CSV includes date, store, item, barcode, quantity, unit, price, and line total

  # From commit: Add export/import functionality for items and trips on Settings page
  Scenario: Export items only as JSON
    Given I have items in my library
    When I navigate to the Settings page
    And I tap "Export Items"
    Then a JSON file is downloaded containing only item data

  # From commit: Add export/import functionality for items and trips on Settings page
  Scenario: Export trips only as JSON
    Given I have completed trips
    When I navigate to the Settings page
    And I tap "Export Trips"
    Then a JSON file is downloaded
    And the file contains trips, associated stores, and price history

  # From commit: Add export/import functionality for items and trips on Settings page
  Scenario: Import full backup
    Given I have a valid full backup JSON file
    When I navigate to the Settings page
    And I tap "Import Full Backup"
    And I select the backup file
    Then I see a confirmation dialog with a warning
    When I confirm the import
    Then all data is restored from the backup
    And I see a success message

  # From commit: Add export/import functionality for items and trips on Settings page
  Scenario: Import items only
    Given I have a valid items JSON export file
    When I tap "Import Items" on the Settings page
    And I select the file
    Then items are imported into the database
    And existing items with matching IDs are skipped
    And I see a success message

  # From commit: Add export/import functionality for items and trips on Settings page
  Scenario: Import trips only
    Given I have a valid trips JSON export file
    When I tap "Import Trips" on the Settings page
    And I select the file
    Then trips are imported into the database
    And associated stores are created if they don't exist
    And existing trips with matching IDs are skipped

  # From commit: Add export/import functionality for items and trips on Settings page
  Scenario: Import invalid file shows error
    Given I have a malformed JSON file
    When I attempt to import it
    Then I see an error message describing the validation issue
    And no data is modified

  # From commit: Add export/import functionality for items and trips on Settings page
  Scenario: Import file with wrong format shows error
    Given I have a valid JSON file but with incorrect keys
    When I attempt to import it as a full backup
    Then I see an error message about missing required keys
    And no data is imported
