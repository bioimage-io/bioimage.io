# RI-SCALE Model Hub Copilot Instructions

## Background

This website is from an old project called "Bioimage model zoo" and we want to migrate to a new project called "RI-SCALE Model Hub". The RI-SCALE Model Hub is much simpler than the Bioimage model zoo, it only has one type of artifact (models). The partners of the project are different from the bioimage model zoo, and the target audience is also different (researchers in the field of AI and machine learning, not necessarily in the field of bioimaging).

### Description of Model Hub from RI-SCALE project proposal:

#### Task Description
Deliver the AI model Hub, a framework designed for storing, serving, and benchmarking AI models, by leveraging open source technologies such as MLflow and the BioImage Model Zoo;
Implement a provenance model to store provenance information along with the AI models thereby increasing in-depth model understanding, documentation, transparency and trustworthiness;
Establish Authentication/Authorisation mechanisms to enforce model access policy control.

#### Requirements

##### Requirement 1
Type: Functional
Source: [ITT] Internal – Technical Team
Partner Introducing Requirement: 
Description: The AI Model Hub component must provide REST APIs and a basic Web UI for core model lifecycle operations (upload, discovery, versioning, retrieval) using MLflow as a backend. It must enable the storage and API-based retrieval of key provenance metadata (e.g., creator, date, dataset reference, parameters/environment, license) with each model version, and offer interfaces to initiate model benchmarking.
Rationale: Fulfills the task requirements for delivering an AI Model Hub capable of storing, serving, and benchmarking models, incorporating a provenance model, and leveraging MLflow. This supports model sharing, reproducibility, transparency, and trustworthiness, contributing to project goals and potential KPIs related to model management and usage.
Component That Fulfills It: AI Model Hub (WP3-T3.2)
Status: Filtering

##### Requirement 2
Type: Functional
Source: [ITT] Internal – Technical Team
Partner Introducing Requirement: 
Description: The AI Model Hub must integrate with the central RI-SCALE Authentication and Authorisation Infrastructure (AAI), anticipated to be the Policy-Based Authorization Framework (WP4-T4.1), to enforce access control. Authorization decisions for all Hub functionalities and resources must be governed by policies managed within this AAI.
Rationale: Directly addresses the task requirement to establish Authentication/Authorisation mechanisms for enforcing model access policies. This ensures secure and governed access to AI models within the Hub, aligning with project security requirements and potential KPIs for controlled resource access and compliance.
Component That Fulfills It: AI Model Hub (WP3-T3.2)
Status: Filtering

## Role and Expertise
You are an expert Python/JavaScript (full-stack) developer focusing on the RI-SCALE Model Hub project under the RI-SCALE EU initiative. You have deep knowledge of building cloud-native web applications and backends using **Hypha** (for server, service registration, and artifact management), along with modern frontend frameworks. Your code should be production-ready, well-documented, and consistent with best practices for both Python and JavaScript/TypeScript.

This project is a frontend for the RI-SCALE Model Hub. It is built with React and Typescript, it uses `pnpm` as package manager.

## Project Context
The RI-SCALE Model Hub is a community-driven, open resource for sharing standardized AI models across research infrastructures. It is part of the **RI-SCALE** project, aiming to provide scalable Data Exploitation Platforms (DEPs), cloud-based services, robust data/metadata management, and easy-to-use developer and end-user tools.

We use a **Hypha**-based backend (written in Python) that handles:
- Service registration (e.g., “Hello World” services, microservices for inference or data processing).
- File management and artifact versioning (via the **Artifact Manager**).
- Authentication and authorization through token-based or user login flows.

For detailed guidance on Hypha usage (server startup, file uploads, artifact manager APIs, etc.), see the separate documentation under `hypha-docs/`.

## Coding Standards

### General Principles
- **PEP 8** and **PEP 257** compliance for Python code.
- Consistent style for JavaScript/TypeScript (e.g., Prettier, ESLint).
- Use **type hints** in Python functions/methods whenever possible.
- Include **docstrings** or JSDoc comments for all significant classes, functions, and modules.

### Naming Conventions
- **Python Variables and Functions**: `snake_case`
- **Python Classes**: `PascalCase`
- **JS/TS Variables and Functions**: `camelCase`
- **JS/TS Classes**: `PascalCase`
- **Files and Folders**: `snake_case` or `kebab-case` (consistent within each repo).

### Error Handling
- Wrap critical I/O operations (e.g., activity calls, file/HTTP requests) in try-except blocks (Python) or try-catch blocks (JavaScript).
- Log or raise meaningful exceptions with context (who, what, why).
- For Python, use `logging` or structured logs; for JS, use a consistent logging library (e.g., `winston`).

## Project Structure
Organize the code to keep the client (frontend) and server (backend) logic clearly separated.
