pipeline {
    agent any

    environment {
        IMAGE_NAME = 'finance-app'
        CONTAINER_NAME = 'finance-app-ci'
        HOST_PORT = '5000'
        CONTAINER_PORT = '5000'
    }

    stages {

        stage('Validate') {
            steps {
                sh '''
                    echo "Validating Python code..."
                    python3 -m compileall -q backend
                    python3 -m pip install -r requirements.txt
                '''
            }
        }

        /*stage('Build Image') {
            steps {
                sh '''
                    echo "Building Docker image..."
                    docker build -t "$IMAGE_NAME:$BUILD_NUMBER" .
                '''
            }
        }*/

        stage('Unit Test') {
            steps {
                sh '''
                    echo "Running backend unit tests..."
                    python3 -m pytest -q unit_test/test_backend.py
                '''
            }
        }
    }

    post {
        always {
            sh '''
                echo "Cleaning up Docker resources..."
                docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
                docker rmi "$IMAGE_NAME:$BUILD_NUMBER" >/dev/null 2>&1 || true
            '''
        }
    }
}