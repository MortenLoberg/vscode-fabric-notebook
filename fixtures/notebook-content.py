# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "ddbcc575-805b-4922-84db-ca451b318755",
# META       "default_lakehouse_name": "SalesLH",
# META       "default_lakehouse_workspace_id": "4caf7825-81ac-4c94-9e46-306b4c20a4d5"
# META     }
# META   }
# META }

# MARKDOWN ********************

# # Sales notebook
# Welcome to Fabric.
# 
# This is a second paragraph.

# CELL ********************

print("hello")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

df = spark.sql("SELECT 1 AS id")
display(df)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
