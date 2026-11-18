terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # Para guardar o estado remotamente (recomendado no plano de DR), crie um bucket
  # e descomente o bloco abaixo. Ver README, seção "Plano de DR".
  # backend "s3" {
  #   bucket = "SEU-BUCKET-DE-ESTADO"
  #   key    = "votacao/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      ManagedBy   = "terraform"
      Environment = "producao"
    }
  }
}
