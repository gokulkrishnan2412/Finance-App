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

        stage('Smoke Test') {
            steps {
                sh '''
                    echo "need to add the smoke test later"
                '''
            }
        }

        stage('Unit Test') {
            steps {
                sh '''
                    echo "need to add the unit test later"
                '''
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